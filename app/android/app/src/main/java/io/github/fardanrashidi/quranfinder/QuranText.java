package io.github.fardanrashidi.quranfinder;

import android.content.Context;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The Quran text auto search looks in: alquran.cloud's quran-simple-clean edition
 * (lib/quran.js's MATCH_EDITION), downloaded the first time and kept. The page
 * keeps its own copy, in the WebView's storage.
 */
final class QuranText {

    private static final String EDITION_URL = "https://api.alquran.cloud/v1/quran/quran-simple-clean";

    private static QuranSearch search;

    private QuranText() {}

    static synchronized QuranSearch search(Context context) throws IOException, JSONException {
        if (search != null) return search;
        File file = new File(context.getNoBackupFilesDir(), "quran/quran-simple-clean.json");
        if (!file.exists()) download(file);
        List<QuranSearch.Surah> surahs = new ArrayList<>();
        try {
            JSONArray list = new JSONObject(read(file))
                .getJSONObject("data")
                .getJSONArray("surahs");
            for (int i = 0; i < list.length(); i++) {
                JSONObject s = list.getJSONObject(i);
                JSONArray ayahs = s.getJSONArray("ayahs");
                List<String> texts = new ArrayList<>();
                for (int a = 0; a < ayahs.length(); a++) texts.add(ayahs.getJSONObject(a).getString("text"));
                surahs.add(new QuranSearch.Surah(s.getInt("number"), s.getString("name"), s.getString("englishName"), texts));
            }
        } catch (JSONException e) {
            file.delete(); // download it again next time
            throw e;
        }
        search = new QuranSearch(surahs);
        return search;
    }

    private static String read(File file) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[1 << 16];
        try (InputStream in = new FileInputStream(file)) {
            for (int n; (n = in.read(buffer)) > 0; ) bytes.write(buffer, 0, n);
        }
        return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
    }

    private static void download(File file) throws IOException {
        file.getParentFile().mkdirs();
        File part = new File(file.getPath() + ".part");
        HttpURLConnection get = (HttpURLConnection) new URL(EDITION_URL).openConnection();
        get.setConnectTimeout(15000);
        get.setReadTimeout(60000);
        try {
            if (get.getResponseCode() != 200) throw new IOException("couldn't download the Quran text (HTTP " + get.getResponseCode() + ")");
            byte[] buffer = new byte[1 << 16];
            try (InputStream in = get.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
            }
        } finally {
            get.disconnect();
        }
        if (!part.renameTo(file)) throw new IOException("couldn't save the Quran text");
    }
}
