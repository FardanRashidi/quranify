package io.github.fardanrashidi.quranfinder;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.ShortBuffer;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Quran speech-to-text for app/src/asr.js, with the model in SpeechModel. */
@CapacitorPlugin(name = "Whisper")
public class WhisperPlugin extends Plugin {

    // Off Capacitor's plugin thread, so other plugins don't wait
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    /** Resolves once the model is ready; sends "progress" events ({ loaded, total } bytes) while downloading. */
    @PluginMethod
    public void load(PluginCall call) {
        worker.execute(() -> {
            try {
                SpeechModel.load(getContext(), this::progress);
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
                ShortBuffer samples = ByteBuffer.wrap(Base64.decode(pcm, Base64.DEFAULT)).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer();
                float[] audio = new float[samples.remaining()];
                for (int i = 0; i < audio.length; i++) audio[i] = samples.get(i) / 32768f;
                JSObject result = new JSObject();
                result.put("text", SpeechModel.transcribe(getContext(), audio, this::progress));
                call.resolve(result);
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    private void progress(long loaded, long total) {
        JSObject data = new JSObject();
        data.put("loaded", loaded);
        data.put("total", total);
        notifyListeners("progress", data);
    }
}
