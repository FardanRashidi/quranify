package io.github.fardanrashidi.quranwhisperer;

import android.content.Context;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

/**
 * The Quran speech model, shared by the page (WhisperPlugin) and auto search
 * (AutoSearchService): downloaded once, loaded once, and run on one clip at a time.
 */
final class SpeechModel {

    interface Progress {
        void update(long loaded, long total);
    }

    // Pinned, since Whisper.java hard-codes the model's token numbers
    private static final String MODEL_URL =
        "https://huggingface.co/YunusZJ/whisper-base-ar-quran-ONNX/resolve/51357169bad27dbd0521bdc5fde9ab168ec7e914/";

    private static Whisper whisper;
    private static final Object RUNNING = new Object(); // two clips at once would only fight over the CPU

    private SpeechModel() {}

    /** Downloads the model the first time (reporting the bytes so far), then loads it. */
    static synchronized Whisper load(Context context, Progress progress) throws Exception {
        if (whisper != null) return whisper;
        File dir = new File(context.getNoBackupFilesDir(), "whisper");
        download(dir, progress);
        // Phones have a few fast cores and some slow ones; more threads than this mostly wait on the slow ones.
        whisper = new Whisper(dir, Math.min(4, Runtime.getRuntime().availableProcessors()));
        return whisper;
    }

    /** @param audio 16 kHz mono, up to 30 s */
    static String transcribe(Context context, float[] audio, Progress progress) throws Exception {
        Whisper model = load(context, progress);
        synchronized (RUNNING) {
            return model.transcribe(audio);
        }
    }

    private static void download(File dir, Progress progress) throws IOException {
        List<String> missing = new ArrayList<>();
        // An empty file is missing too (length() is 0 for one that isn't there): a bad download shouldn't stick
        for (String name : Whisper.FILES) if (new File(dir, name).length() == 0) missing.add(name);
        if (missing.isEmpty()) return;
        long total = 0; // sizes first, so the progress covers all the files
        for (String name : missing) {
            HttpURLConnection head = open(name, "HEAD");
            total += Math.max(0, head.getContentLengthLong());
            head.disconnect();
        }

        long loaded = 0, reported = 0;
        byte[] buffer = new byte[1 << 16];
        for (String name : missing) {
            File file = new File(dir, name);
            File part = new File(file.getPath() + ".part");
            file.getParentFile().mkdirs();
            HttpURLConnection get = open(name, "GET");
            long size = get.getContentLengthLong(), got = 0;
            try (InputStream in = get.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                for (int n; (n = in.read(buffer)) > 0; ) {
                    out.write(buffer, 0, n);
                    got += n;
                    if (loaded + got - reported > 1 << 20) progress.update(reported = loaded + got, total);
                }
            } finally {
                get.disconnect();
            }
            if (size >= 0 && got != size) throw new IOException("the speech model download was cut off");
            if (!part.renameTo(file)) throw new IOException("couldn't save the speech model");
            loaded += got;
        }
        progress.update(loaded, Math.max(loaded, total));
    }

    private static HttpURLConnection open(String path, String method) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(MODEL_URL + path).openConnection();
        connection.setRequestMethod(method);
        // The exact bytes: Hugging Face gzips vocab.json when asked, which Android does unless told otherwise
        connection.setRequestProperty("Accept-Encoding", "identity");
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        if (connection.getResponseCode() != 200) {
            throw new IOException("couldn't download the speech model (HTTP " + connection.getResponseCode() + ")");
        }
        return connection;
    }
}
