package io.github.fardanrashidi.quranwhisperer;

import android.content.Context;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * What auto search has heard, for the page's history: an entry each time it finds
 * a surah, { surah, from, to, start, end } (the ayahs heard, and when, in ms since
 * 1970), which later ayahs of the same surah extend. Kept in a small JSON file,
 * oldest first, up to the latest MAX entries.
 */
final class AutoSearchHistory {

    private static final String TAG = "AutoSearch";
    private static final String FILE = "auto-search-history.json";
    private static final int MAX = 200;

    private AutoSearchHistory() {}

    /** Heard this ayah: a new entry if `isNew` (or it's another surah), otherwise the latest one goes on to it. */
    static synchronized void heard(Context context, int surah, int ayah, boolean isNew) {
        JSONArray entries = list(context);
        JSONObject last = entries.optJSONObject(entries.length() - 1);
        long now = System.currentTimeMillis();
        try {
            if (isNew || last == null || last.optInt("surah") != surah) {
                entries.put(new JSONObject().put("surah", surah).put("from", ayah).put("to", ayah).put("start", now).put("end", now));
                while (entries.length() > MAX) entries.remove(0);
            } else {
                last.put("from", Math.min(last.optInt("from", ayah), ayah)).put("to", Math.max(last.optInt("to", ayah), ayah)).put("end", now);
            }
            write(context, entries.toString());
        } catch (JSONException | IOException e) {
            Log.w(TAG, "couldn't save the history", e);
        }
    }

    /** Every entry, oldest first (none if there's no history, or it can't be read). */
    static synchronized JSONArray list(Context context) {
        File file = file(context);
        if (!file.exists()) return new JSONArray();
        try {
            return new JSONArray(read(file));
        } catch (JSONException | IOException e) {
            Log.w(TAG, "couldn't read the history", e);
            return new JSONArray();
        }
    }

    static synchronized void clear(Context context) {
        file(context).delete();
    }

    private static File file(Context context) {
        return new File(context.getFilesDir(), FILE);
    }

    private static String read(File file) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[1 << 14];
        try (InputStream in = new FileInputStream(file)) {
            for (int n; (n = in.read(buffer)) > 0; ) bytes.write(buffer, 0, n);
        }
        return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
    }

    // Written beside it and then moved over it, so a write cut short can't spoil it.
    private static void write(Context context, String json) throws IOException {
        File file = file(context);
        File part = new File(file.getPath() + ".part");
        try (OutputStream out = new FileOutputStream(part)) {
            out.write(json.getBytes(StandardCharsets.UTF_8));
        }
        if (!part.renameTo(file)) throw new IOException("couldn't save " + file);
    }
}
