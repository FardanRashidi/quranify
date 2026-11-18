package io.github.fardanrashidi.quranwhisperer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;
import androidx.core.app.NotificationCompat;

/**
 * Keeps the page's Listen and Read aloud going with the screen off, or the app in the
 * background, and says so in a notification (with a Stop button).
 *
 * The page records through the WebView, and Android only lets an app that isn't on
 * screen keep using the microphone while it has a foreground service of the
 * microphone type; reading aloud on its own is a media playback one. Either way it
 * also holds a wake lock, so the page keeps running. ScreenPlugin starts it, updates
 * what the notification says, and stops it.
 */
public class BackgroundService extends Service {

    static final String ACTION_STOP = "io.github.fardanrashidi.quranwhisperer.STOP_BACKGROUND";
    private static final String EXTRA_LISTENING = "listening", EXTRA_READING = "reading", EXTRA_TEXT = "text";

    private static final String TAG = "Background";
    private static final String CHANNEL = "listening";
    private static final int ID = 3; // AutoSearchService has 1 and 2

    private PowerManager.WakeLock wakeLock;

    /** Starts it, or updates what it's doing and what its notification says. */
    static void update(Context context, boolean listening, boolean reading, String text) {
        Intent intent = new Intent(context, BackgroundService.class)
            .putExtra(EXTRA_LISTENING, listening)
            .putExtra(EXTRA_READING, reading)
            .putExtra(EXTRA_TEXT, text);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (RuntimeException e) {
            Log.w(TAG, "couldn't start", e); // it all still works while the app's on screen
        }
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, BackgroundService.class));
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            ScreenPlugin.stopFromNotification(); // the page stops listening and reading
            stopSelf();
            return START_NOT_STICKY;
        }
        boolean listening = intent != null && intent.getBooleanExtra(EXTRA_LISTENING, false);
        boolean reading = intent != null && intent.getBooleanExtra(EXTRA_READING, false);
        String text = intent != null ? intent.getStringExtra(EXTRA_TEXT) : null;
        Notification notification = notification(listening, reading, text);
        if (!goForeground(notification, listening, reading)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (wakeLock == null) {
            wakeLock = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "quranwhisperer:background");
            wakeLock.acquire();
        }
        return START_NOT_STICKY;
    }

    // Each start wants this, the type saying what it's for. The microphone isn't allowed
    // from the background (Listen started with the screen off): then only the reading.
    private boolean goForeground(Notification notification, boolean listening, boolean reading) {
        if (Build.VERSION.SDK_INT < 29) {
            startForeground(ID, notification);
            return true;
        }
        int media = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
        int type = (listening ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0) | (reading || !listening ? media : 0);
        try {
            startForeground(ID, notification, type);
            return true;
        } catch (RuntimeException e) {
            Log.w(TAG, "couldn't go into the foreground as " + type, e);
        }
        if (type == media) return false;
        try {
            startForeground(ID, notification, media);
            return true;
        } catch (RuntimeException e) {
            Log.w(TAG, "couldn't go into the foreground at all", e);
            return false;
        }
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        super.onDestroy();
    }

    private Notification notification(boolean listening, boolean reading, String text) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Listening and reading aloud", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shows while Listen or Read aloud is on, so they keep going with the screen off");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
        String title = listening && reading ? "Listening and reading aloud" : listening ? "Listening" : "Reading aloud";
        Intent back = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent open = PendingIntent.getActivity(this, 1, back, PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, BackgroundService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_auto_search)
            .setContentTitle(title)
            .setContentText(text != null && !text.isEmpty() ? text : "Running in the background. Tap to go back to it.")
            .setContentIntent(open)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(0, "Stop", stop)
            .build();
    }
}
