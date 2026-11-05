package io.github.fardanrashidi.quranwhisperer;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * The recorded English voice (Ibrahim Walk, one MP3 per ayah) saved on the phone, so the
 * translation can be read aloud without the internet: for public/js/saved-voice.js. Each ayah is
 * a file, n.mp3, numbered from 1 (1:1) to 6236 (114:6), kept out of backups like the speech
 * model. The page reads them through Capacitor's file URLs.
 */
@CapacitorPlugin(name = "SavedVoice")
public class SavedVoicePlugin extends Plugin {

    // Files at a time. Each is small (about 80 KB), so much of it is waiting for the reply to start.
    private static final int CONNECTIONS = 3;
    private static final int TRIES = 3;

    // One save at a time, in the order asked for, so a surah finishes before the next starts
    private final ExecutorService queue = Executors.newSingleThreadExecutor();
    private final ExecutorService fetchers = Executors.newFixedThreadPool(CONNECTIONS);
    private final AtomicInteger generation = new AtomicInteger(); // bumped by cancel() without an id: stops them all
    private final Set<String> cancelled = ConcurrentHashMap.newKeySet();

    private File dir() {
        return new File(getContext().getNoBackupFilesDir(), "en.walk");
    }

    /** → { path, ayahs: [n, …], bytes }: what's saved, where (for Capacitor.convertFileSrc), and its size. */
    @PluginMethod
    public void status(PluginCall call) {
        JSArray ayahs = new JSArray();
        long bytes = 0;
        File[] files = dir().listFiles();
        if (files != null) {
            for (File file : files) {
                int n = ayahOf(file);
                if (n == 0) continue;
                ayahs.put(n);
                bytes += file.length();
            }
        }
        JSObject result = new JSObject();
        result.put("path", dir().getAbsolutePath());
        result.put("ayahs", ayahs);
        result.put("bytes", bytes);
        call.resolve(result);
    }

    /**
     * { id, url, from, to }: saves ayahs from–to that aren't saved yet, from url ({n} being the
     * ayah's number). Resolves { saved: true } once they all are, or { saved: false } if it was
     * cancelled. Rejects if a file can't be fetched after a few tries. Sends "start" ({ id }) as
     * it begins, and "saved" ({ id, ayah, bytes }) as each file arrives.
     */
    @PluginMethod
    public void save(PluginCall call) {
        String id = call.getString("id", "");
        String url = call.getString("url");
        Integer from = call.getInt("from"), to = call.getInt("to");
        if (url == null || !url.startsWith("https://") || !url.contains("{n}") || from == null || to == null || from < 1 || to < from) {
            call.reject("nothing to save");
            return;
        }
        int asked = generation.get();
        queue.execute(() -> {
            try {
                JSObject result = new JSObject();
                result.put("saved", !stopped(id, asked) && fetchAll(id, url, from, to, asked));
                call.resolve(result);
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            } finally {
                cancelled.remove(id);
            }
        });
    }

    /** { id }: stops that save, whether it's started or still waiting. Without an id, all of them. */
    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id");
        if (id == null) generation.incrementAndGet();
        else cancelled.add(id);
        call.resolve();
    }

    /** { from, to }: deletes those ayahs' files. Without them, every one. Cancel the saves first. */
    @PluginMethod
    public void remove(PluginCall call) {
        int from = call.getInt("from", 1), to = call.getInt("to", Integer.MAX_VALUE);
        File[] files = dir().listFiles();
        if (files != null) {
            for (File file : files) {
                String name = file.getName();
                int n = parseAyah(name.endsWith(".part") ? name.substring(0, name.length() - 5) : name); // a download cut off
                if (n >= from && n <= to) file.delete();
            }
        }
        call.resolve();
    }

    private boolean stopped(String id, int asked) {
        return asked != generation.get() || cancelled.contains(id);
    }

    private boolean fetchAll(String id, String url, int from, int to, int asked) throws Exception {
        File dir = dir();
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("couldn't make a folder for it");
        JSObject start = new JSObject();
        start.put("id", id);
        notifyListeners("start", start);

        List<Future<Void>> files = new ArrayList<>();
        for (int n = from; n <= to; n++) {
            // An empty file is missing too (length() is 0 for one that isn't there)
            if (new File(dir, n + ".mp3").length() > 0) continue;
            int ayah = n;
            Callable<Void> fetch = () -> {
                if (stopped(id, asked)) return null;
                long bytes = fetch(url, dir, ayah, () -> stopped(id, asked));
                if (bytes < 0) return null;
                JSObject saved = new JSObject();
                saved.put("id", id);
                saved.put("ayah", ayah);
                saved.put("bytes", bytes);
                notifyListeners("saved", saved);
                return null;
            };
            files.add(fetchers.submit(fetch));
        }
        try {
            for (Future<Void> file : files) file.get();
        } catch (ExecutionException e) {
            for (Future<Void> file : files) file.cancel(false);
            Throwable cause = e.getCause();
            throw cause instanceof Exception ? (Exception) cause : e;
        }
        return !stopped(id, asked);
    }

    private interface Stopped {
        boolean now();
    }

    /**
     * Downloads one ayah's file, trying again after a failure, and returns its size, or -1 if
     * the save was stopped meanwhile. Then the file's dropped, since stopping comes before
     * deleting: it would turn up again just after.
     */
    private long fetch(String template, File dir, int n, Stopped stopped) throws IOException {
        File file = new File(dir, n + ".mp3");
        File part = new File(dir, n + ".mp3.part");
        IOException failure = null;
        for (int attempt = 1; attempt <= TRIES; attempt++) {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(template.replace("{n}", String.valueOf(n))).openConnection();
                connection.setRequestProperty("Accept-Encoding", "identity"); // the exact bytes, to check the length
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                int status = connection.getResponseCode();
                if (status != 200) throw new IOException("HTTP " + status);
                long size = connection.getContentLengthLong(), got = 0;
                byte[] buffer = new byte[1 << 14];
                try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                    for (int read; (read = in.read(buffer)) > 0; ) {
                        out.write(buffer, 0, read);
                        got += read;
                    }
                }
                if (got == 0 || (size >= 0 && got != size)) throw new IOException("the download was cut off");
                if (stopped.now()) {
                    part.delete();
                    return -1;
                }
                if (!part.renameTo(file)) throw new IOException("couldn't save it");
                return got;
            } catch (IOException e) {
                failure = e;
                part.delete();
                if (stopped.now()) return -1;
                if (attempt < TRIES) pause(1000L * attempt);
            } finally {
                if (connection != null) connection.disconnect();
            }
        }
        throw new IOException("couldn't download ayah " + n + " (" + failure.getMessage() + ")", failure);
    }

    private static void pause(long ms) throws IOException {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("stopped");
        }
    }

    /** A saved ayah's number from its file, or 0 for anything else (a download still going, say). */
    private static int ayahOf(File file) {
        return file.length() > 0 ? parseAyah(file.getName()) : 0;
    }

    private static int parseAyah(String name) {
        if (!name.endsWith(".mp3")) return 0;
        try {
            return Integer.parseInt(name.substring(0, name.length() - 4));
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
