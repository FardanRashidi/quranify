package io.github.fardanrashidi.quranwhisperer;

import android.content.Context;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The Quran text auto search looks in: alquran.cloud's quran-simple-clean edition
 * (lib/quran.js's MATCH_EDITION), which comes with the app. app/build.mjs puts it
 * among the page's files, as [{ number, name, englishName, ayahs: [text] }].
 */
final class QuranText {

    private static final String ASSET = "public/quran/quran-simple-clean.json";

    private static QuranSearch search;

    private QuranText() {}

    static synchronized QuranSearch search(Context context) throws IOException, JSONException {
        if (search != null) return search;
        // Before the text came with the app, it was downloaded to here.
        new File(context.getNoBackupFilesDir(), "quran/quran-simple-clean.json").delete();

        List<QuranSearch.Surah> surahs = new ArrayList<>();
        JSONArray list = new JSONArray(read(context, ASSET));
        for (int i = 0; i < list.length(); i++) {
            JSONObject s = list.getJSONObject(i);
            JSONArray ayahs = s.getJSONArray("ayahs");
            List<String> texts = new ArrayList<>();
            for (int a = 0; a < ayahs.length(); a++) texts.add(ayahs.getString(a));
            surahs.add(new QuranSearch.Surah(s.getInt("number"), s.getString("name"), s.getString("englishName"), texts));
        }
        search = new QuranSearch(surahs);
        return search;
    }

    private static String read(Context context, String asset) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[1 << 16];
        try (InputStream in = context.getAssets().open(asset)) {
            for (int n; (n = in.read(buffer)) > 0; ) bytes.write(buffer, 0, n);
        }
        return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
    }
}
