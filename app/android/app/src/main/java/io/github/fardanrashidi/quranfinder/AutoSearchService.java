package io.github.fardanrashidi.quranfinder;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.ServiceInfo;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;

/**
 * Auto search: listens in the background, with the screen off too, and posts a
 * notification for each surah it recognises, the way Auto Shazam does for songs.
 * AutoSearchActivity starts it (from the Quick Settings tile, or the app's
 * settings), and it runs until the tile or the notification's Stop turns it off.
 *
 * It does what the page's Listen & sync does, natively: the same speech model
 * (SpeechModel) and the same search (QuranSearch, a port of lib/quran.js). It
 * checks less often, for the battery: every few seconds until it finds a surah,
 * then every 15 s, to notice the recitation moving on to another one.
 */
public class AutoSearchService extends Service {

    static final String ACTION_STOP = "io.github.fardanrashidi.quranfinder.STOP_AUTO_SEARCH";
    static final String EXTRA_SURAH = "surah", EXTRA_AYAH = "ayah";

    private static final String TAG = "AutoSearch";
    private static final int RATE = 16000; // what the speech model expects
    private static final int RING_SECONDS = 12;
    private static final int CLIP_SECONDS = 8;
    private static final double FIRST_TRY_AFTER = 4; // seconds of audio before the first check
    private static final double SEARCH_EVERY = 3; // seconds between checks until it finds a surah
    private static final double SEARCH_EVERY_LATER = 10; // ...once it's heard a minute of sound that isn't a recitation
    private static final int SLOW_DOWN_AFTER = 20; // checks without a match
    private static final double RECHECK_EVERY = 15; // once it has: has the recitation moved on to another surah?
    private static final double QUIET_RETRY = 2; // a quiet clip costs nothing to check, so look again soon
    private static final double MIN_AUDIBLE = 3; // seconds of actual sound a clip needs before it's worth transcribing
    private static final double SILENCE_RMS = 0.002; // ≈ -54 dBFS, as in listener.js
    private static final double MAX_GAIN = 20;
    private static final int REACH = 60; // words: how far on a passage that's in more than one place may be, and still be the reciter's
    private static final long FORGET_AFTER_MS = 120_000; // not heard for this long, the surah is news again when it comes back

    private static final String CHANNEL_LISTENING = "auto-search", CHANNEL_FOUND = "found";
    private static final int LISTENING_ID = 1, PROBLEM_ID = 2, FOUND_ID = 1000; // + the surah's number

    private static volatile boolean running;
    private static volatile String status = "";

    private volatile boolean stopping;
    private volatile String text = "Getting ready…"; // what the listening notification says
    private volatile AudioSource source;
    private Thread checker;
    private PowerManager.WakeLock wakeLock;
    private final Ring ring = new Ring(RING_SECONDS * RATE);

    static boolean isRunning() {
        return running;
    }

    /** What it's doing, for the tile: Listening, Yaseen 36:13, ... */
    static String status() {
        return status;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        createChannels();
        try {
            // Each startForegroundService() wants this, even when it's already running.
            Notification notification = listening(text);
            if (Build.VERSION.SDK_INT >= 30) startForeground(LISTENING_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(LISTENING_ID, notification);
        } catch (RuntimeException e) {
            // Not allowed to use the microphone from the background: AutoSearchActivity should have started it.
            Log.w(TAG, "couldn't start", e);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (checker != null) return START_NOT_STICKY; // already listening
        running = true;
        setStatus("Getting ready");
        wakeLock = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "quranfinder:auto-search");
        wakeLock.acquire();
        checker = new Thread(this::run, "auto-search");
        checker.start();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        stopping = true;
        AudioSource current = source;
        if (current != null) current.stop();
        if (checker != null) checker.interrupt();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        running = false;
        setStatus("");
        super.onDestroy();
    }

    // --- listening ---------------------------------------------------------------

    private void run() {
        try {
            QuranSearch search = QuranText.search(this);
            SpeechModel.load(this, (loaded, total) -> {
                setStatus("Downloading " + loaded * 100 / Math.max(1, total) + "%");
                update("Downloading the speech model (the first time only)… " + loaded * 100 / Math.max(1, total) + "%");
            });
            if (stopping) return;
            source = openSource();
            Thread recorder = new Thread(this::record, "auto-search-audio");
            recorder.start();
            setStatus("Listening");
            update("Listening for a recitation");
            listen(search);
        } catch (InterruptedException e) {
            // stopped
        } catch (Exception e) {
            if (!stopping) fail(e);
        } finally {
            // in case a check finished after onDestroy() and put it back
            notifications().cancel(LISTENING_ID);
        }
    }

    /** Keeps the ring buffer filled from the microphone (on its own thread, so checks don't miss any). */
    private void record() {
        AudioSource from = source;
        short[] chunk = new short[RATE / 10];
        try {
            while (!stopping) {
                int n = from.read(chunk);
                if (n < 0) throw new IOException("the microphone stopped working (" + n + ")");
                ring.write(chunk, n);
            }
        } catch (Exception e) {
            if (!stopping) fail(e);
        } finally {
            from.close();
        }
    }

    private void listen(QuranSearch search) throws Exception {
        double wait = FIRST_TRY_AFTER;
        Integer near = null; // the last word heard, once a surah has been found
        int surah = 0; // ...and which one
        long heardAt = 0; // ...and when it was last heard
        int misses = 0;
        while (!stopping) {
            Thread.sleep((long) (wait * 1000));
            float[] audio = prepare(ring.last(CLIP_SECONDS * RATE));
            if (audio == null) {
                wait = QUIET_RETRY;
                continue;
            }
            QuranSearch.Match match = search.locate(SpeechModel.transcribe(this, audio, null), near);
            if (stopping) return;
            if (surah == 0) {
                // Searching: only a clear match will do, as with Listen & sync.
                if (match != null && !match.ambiguous) {
                    found(search, match, true);
                    surah = match.surah;
                    near = match.word;
                    heardAt = SystemClock.elapsedRealtime();
                    wait = RECHECK_EVERY;
                } else {
                    misses++;
                    wait = misses < SLOW_DOWN_AFTER ? SEARCH_EVERY : SEARCH_EVERY_LATER;
                }
                continue;
            }
            // Found one: keep up with the reciter, loosely, and notice a new surah.
            boolean believable = match != null &&
                (!match.ambiguous || (match.continues && match.word >= near && match.word - near <= REACH));
            if (believable) {
                long now = SystemClock.elapsedRealtime();
                found(search, match, match.surah != surah || now - heardAt > FORGET_AFTER_MS);
                surah = match.surah;
                near = match.word;
                heardAt = now;
            }
            wait = RECHECK_EVERY;
        }
    }

    /** The clip as the page would send it (listener.js): null if it's too quiet, else louder. */
    private static float[] prepare(float[] clip) {
        int window = RATE / 10;
        int audible = 0;
        float peak = 0;
        for (int w = 0; w + window <= clip.length; w += window) {
            double sum = 0;
            for (int i = w; i < w + window; i++) {
                sum += clip[i] * clip[i];
                peak = Math.max(peak, Math.abs(clip[i]));
            }
            if (Math.sqrt(sum / window) > SILENCE_RMS) audible++;
        }
        if (audible / 10.0 < MIN_AUDIBLE) return null;
        double gain = peak > 0 ? Math.min(0.9 / peak, MAX_GAIN) : 1;
        float[] out = new float[clip.length];
        for (int i = 0; i < clip.length; i++) out[i] = Math.round(Math.max(-1, Math.min(1, clip[i] * gain)) * 32767) / 32768f;
        return out;
    }

    // --- notifications -------------------------------------------------------------

    private void found(QuranSearch search, QuranSearch.Match match, boolean isNew) {
        QuranSearch.Surah surah = search.surah(match.surah);
        String place = surah.englishName + " " + match.surah + ":" + match.ayah;
        setStatus(place);
        update("Found " + place + " · still listening");
        int id = FOUND_ID + match.surah;
        // Later ayahs of the same surah update its notification, quietly, but don't bring it back once it's gone.
        if (!isNew && !showing(id)) return;
        Intent open = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(EXTRA_SURAH, match.surah)
            .putExtra(EXTRA_AYAH, match.ayah);
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_FOUND)
            .setSmallIcon(R.drawable.ic_auto_search)
            .setContentTitle(place)
            .setContentText(surah.name + " · tap to open it at this ayah")
            .setContentIntent(PendingIntent.getActivity(this, match.surah, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(true)
            .build();
        notifications().notify(id, notification);
    }

    private boolean showing(int id) {
        for (StatusBarNotification n : notifications().getActiveNotifications()) if (n.getId() == id) return true;
        return false;
    }

    /** The notification it shows while it's on, with a Stop button. */
    private Notification listening(String text) {
        PendingIntent stop = PendingIntent.getService(this, 0, new Intent(this, AutoSearchService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL_LISTENING)
            .setSmallIcon(R.drawable.ic_auto_search)
            .setContentTitle("Auto search is on")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setSilent(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(0, "Stop", stop)
            .build();
    }

    private void update(String text) {
        this.text = text;
        if (!stopping) notifications().notify(LISTENING_ID, listening(text));
    }

    private void fail(Exception e) {
        Log.w(TAG, "stopped", e);
        String reason = e.getMessage() != null ? e.getMessage() : e.toString();
        if (e instanceof java.net.UnknownHostException) reason = "no internet connection, to download what it needs the first time";
        notifications().notify(PROBLEM_ID, new NotificationCompat.Builder(this, CHANNEL_FOUND)
            .setSmallIcon(R.drawable.ic_auto_search)
            .setContentTitle("Auto search stopped")
            .setContentText(reason)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(reason))
            .setAutoCancel(true)
            .build());
        stopSelf();
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel listening = new NotificationChannel(CHANNEL_LISTENING, "Auto search", NotificationManager.IMPORTANCE_LOW);
        listening.setDescription("Shows while auto search is listening");
        NotificationChannel found = new NotificationChannel(CHANNEL_FOUND, "Surahs found", NotificationManager.IMPORTANCE_DEFAULT);
        found.setDescription("A notification for each surah auto search recognises");
        notifications().createNotificationChannel(listening);
        notifications().createNotificationChannel(found);
    }

    private NotificationManager notifications() {
        return getSystemService(NotificationManager.class);
    }

    private void setStatus(String text) {
        status = text;
        AutoSearchTile.refresh(this);
    }

    // --- audio ---------------------------------------------------------------------

    private AudioSource openSource() throws IOException {
        // Debug builds play this recording instead of the microphone, for testing on the emulator.
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            File test = new File(getExternalFilesDir(null), "test-recitation.pcm");
            if (test.exists()) return new FileSource(test);
        }
        return new MicSource();
    }

    private interface AudioSource {
        /** Blocks until there's audio: 16 kHz mono samples, how many, or a negative error code. */
        int read(short[] buffer) throws IOException, InterruptedException;

        /** Makes a read in progress return, from another thread. */
        void stop();

        void close();
    }

    private static final class MicSource implements AudioSource {
        private final AudioRecord record;

        @SuppressLint("MissingPermission") // AutoSearchActivity has it granted first
        MicSource() throws IOException {
            int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            // Speech recognition's input has no noise suppression or gain control, which can strip a
            // recitation out (the page turns them off too).
            record = new AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                Math.max(min, RATE * 2) // a second
            );
            if (record.getState() != AudioRecord.STATE_INITIALIZED) {
                record.release();
                throw new IOException("couldn't open the microphone");
            }
            record.startRecording();
        }

        @Override
        public int read(short[] buffer) {
            return record.read(buffer, 0, buffer.length);
        }

        @Override
        public void stop() {
            try {
                record.stop();
            } catch (IllegalStateException ignored) {}
        }

        @Override
        public void close() {
            record.release();
        }
    }

    /** A 16 kHz mono s16le recording, as if the microphone were hearing it now; silence after it ends. */
    private static final class FileSource implements AudioSource {
        private final InputStream in;
        private final long startedAt = SystemClock.elapsedRealtime();
        private long samples;
        private boolean ended;

        FileSource(File file) throws IOException {
            in = new FileInputStream(file);
        }

        @Override
        public int read(short[] buffer) throws IOException, InterruptedException {
            long due = startedAt + samples * 1000 / RATE;
            long now = SystemClock.elapsedRealtime();
            if (due > now) Thread.sleep(due - now);
            byte[] bytes = new byte[buffer.length * 2];
            int got = 0;
            while (!ended && got < bytes.length) {
                int n = in.read(bytes, got, bytes.length - got);
                if (n < 0) ended = true;
                else got += n;
            }
            Arrays.fill(buffer, (short) 0);
            for (int i = 0; i < got / 2; i++) buffer[i] = (short) ((bytes[2 * i] & 0xff) | (bytes[2 * i + 1] << 8));
            samples += buffer.length;
            return buffer.length;
        }

        @Override
        public void stop() {}

        @Override
        public void close() {
            try {
                in.close();
            } catch (IOException ignored) {}
        }
    }

    /** The last RING_SECONDS of audio. */
    private static final class Ring {
        private final short[] samples;
        private long written;

        Ring(int size) {
            samples = new short[size];
        }

        synchronized void write(short[] chunk, int n) {
            for (int i = 0; i < n; i++) samples[(int) ((written + i) % samples.length)] = chunk[i];
            written += n;
        }

        /** The latest `n` samples (fewer at first), from -1 to 1. */
        synchronized float[] last(int n) {
            n = (int) Math.min(n, Math.min(written, samples.length));
            float[] out = new float[n];
            for (int i = 0; i < n; i++) out[i] = samples[(int) ((written - n + i) % samples.length)] / 32768f;
            return out;
        }
    }
}
