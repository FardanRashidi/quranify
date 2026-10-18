package io.github.fardanrashidi.quranfinder;

import android.util.Base64;
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
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.ShortBuffer;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Quran speech-to-text for app/src/asr.js: downloads the model once, then runs it with Whisper.java. */
@CapacitorPlugin(name = "Whisper")
public class WhisperPlugin extends Plugin {

    // Pinned, since Whisper.java hard-codes the model's token numbers
    private static final String MODEL_URL =
        "https://huggingface.co/YunusZJ/whisper-base-ar-quran-ONNX/resolve/51357169bad27dbd0521bdc5fde9ab168ec7e914/";

    // One model job at a time, and off Capacitor's plugin thread so other plugins don't wait
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private Whisper whisper;

    /** Resolves once the model is ready; sends "progress" events ({ loaded, total } bytes) while downloading. */
    @PluginMethod
    public void load(PluginCall call) {
        worker.execute(() -> {
            try {
                ensureLoaded();
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    /** { pcm: base64 16 kHz mono s16le } → { text } */
    @PluginMethod
    public void transcribe(PluginCall call) {
        String pcm = call.getString("pcm");
        if (pcm == null) {
            call.reject("missing pcm");
            return;
        }
        worker.execute(() -> {
            try {
                ensureLoaded();
                ShortBuffer samples = ByteBuffer.wrap(Base64.decode(pcm, Base64.DEFAULT)).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer();
                float[] audio = new float[samples.remaining()];
                for (int i = 0; i < audio.length; i++) audio[i] = samples.get(i) / 32768f;
                JSObject result = new JSObject();
                result.put("text", whisper.transcribe(audio));
                call.resolve(result);
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    private void ensureLoaded() throws Exception {
        if (whisper != null) return;
        File dir = new File(getContext().getNoBackupFilesDir(), "whisper");
        download(dir);
        // Phones have a few fast cores and some slow ones; more threads than this mostly wait on the slow ones.
        whisper = new Whisper(dir, Math.min(4, Runtime.getRuntime().availableProcessors()));
    }

    private void download(File dir) throws IOException {
        List<String> missing = new ArrayList<>();
        for (String name : Whisper.FILES) if (!new File(dir, name).exists()) missing.add(name);
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
                    if (loaded + got - reported > 1 << 20) progress(reported = loaded + got, total);
                }
            } finally {
                get.disconnect();
            }
            if (size >= 0 && got != size) throw new IOException("the speech model download was cut off");
            if (!part.renameTo(file)) throw new IOException("couldn't save the speech model");
            loaded += got;
        }
        progress(loaded, Math.max(loaded, total));
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

    private void progress(long loaded, long total) {
        JSObject data = new JSObject();
        data.put("loaded", loaded);
        data.put("total", total);
        notifyListeners("progress", data);
    }
}
