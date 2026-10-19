package io.github.fardanrashidi.quranwhisperer;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Reads the translation aloud for app/src/speech.js with Android's text-to-speech, since the WebView
 * has none. Sends "word" events ({ id, start, end }) as each word is said, where the voice reports them.
 */
@CapacitorPlugin(name = "Speech")
public class SpeechPlugin extends Plugin {

    private TextToSpeech tts;
    private Boolean ready; // null while the engine starts up, then whether it did
    private final List<Runnable> waiting = new ArrayList<>(); // calls that came before it was ready
    private final Map<String, PluginCall> speaking = new ConcurrentHashMap<>(); // utterance id → its speak() call

    @Override
    public void load() {
        tts = new TextToSpeech(getContext(), status -> {
            List<Runnable> queued;
            synchronized (waiting) {
                ready = status == TextToSpeech.SUCCESS;
                queued = new ArrayList<>(waiting);
                waiting.clear();
            }
            for (Runnable call : queued) call.run();
        });
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String id) {}

            @Override
            public void onDone(String id) {
                finish(id, true);
            }

            @Override
            public void onStop(String id, boolean interrupted) {
                finish(id, false);
            }

            @Override
            @Deprecated
            public void onError(String id) {
                fail(id, "the voice failed");
            }

            @Override
            public void onError(String id, int code) {
                fail(id, code == TextToSpeech.ERROR_NOT_INSTALLED_YET ? "the voice is still downloading" : "the voice failed (" + code + ")");
            }

            @Override
            public void onRangeStart(String id, int start, int end, int frame) {
                JSObject word = new JSObject();
                word.put("id", id);
                word.put("start", start);
                word.put("end", end);
                notifyListeners("word", word);
            }
        });
    }

    /** → { voices: [{ id, name, lang, default }] }, the ones installed on the phone */
    @PluginMethod
    public void voices(PluginCall call) {
        whenReady(call, () -> {
            JSArray list = new JSArray();
            Voice fallback = tts.getDefaultVoice();
            Set<Voice> voices = tts.getVoices();
            if (voices != null) {
                for (Voice voice : voices) {
                    if (voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                    // Google's are named like en-us-x-tpf-local: the part after -x- tells them apart.
                    String name = voice.getName();
                    int code = name.indexOf("-x-");
                    JSObject entry = new JSObject();
                    entry.put("id", name);
                    entry.put("name", code >= 0 ? name.substring(code + 3) : name);
                    entry.put("lang", voice.getLocale().toLanguageTag());
                    entry.put("default", fallback != null && name.equals(fallback.getName()));
                    list.put(entry);
                }
            }
            JSObject result = new JSObject();
            result.put("voices", list);
            call.resolve(result);
        });
    }

    /** Opens the voice engine's page for downloading voices (Google's lists every language it has), or else Android's text-to-speech settings. */
    @PluginMethod
    public void installVoices(PluginCall call) {
        Intent download = new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA).setPackage(tts.getDefaultEngine());
        for (Intent intent : new Intent[] { download, new Intent("com.android.settings.TTS_SETTINGS") }) {
            try {
                getActivity().startActivity(intent);
                call.resolve();
                return;
            } catch (ActivityNotFoundException e) {
                // try the next
            }
        }
        call.reject("no text-to-speech settings on this phone");
    }

    /** { id, text, voice, lang, rate } → { finished } once it's been said, or stopped */
    @PluginMethod
    public void speak(PluginCall call) {
        String id = call.getString("id");
        String text = call.getString("text");
        if (id == null || text == null) {
            call.reject("missing id or text");
            return;
        }
        String voiceName = call.getString("voice", "");
        String lang = call.getString("lang", "en");
        float rate = call.getFloat("rate", 1f);
        whenReady(call, () -> {
            Voice voice = null;
            Set<Voice> voices = tts.getVoices();
            if (voices != null) for (Voice v : voices) if (v.getName().equals(voiceName)) voice = v;
            if (voice != null) {
                tts.setVoice(voice);
            } else {
                int result = tts.setLanguage(Locale.forLanguageTag(lang));
                if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                    call.reject("no voice for " + lang + " on this phone");
                    return;
                }
            }
            tts.setSpeechRate(rate);
            speaking.put(id, call);
            if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) fail(id, "the voice failed");
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (Boolean.TRUE.equals(ready)) tts.stop();
        // Not every engine reports what it stopped.
        for (String id : speaking.keySet()) finish(id, false);
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        tts.shutdown();
    }

    private void whenReady(PluginCall call, Runnable action) {
        synchronized (waiting) {
            if (ready == null) {
                waiting.add(() -> whenReady(call, action));
                return;
            }
        }
        if (ready) action.run();
        else call.reject("this phone has no text-to-speech engine");
    }

    private void finish(String id, boolean finished) {
        PluginCall call = speaking.remove(id);
        if (call == null) return;
        JSObject result = new JSObject();
        result.put("finished", finished);
        call.resolve(result);
    }

    private void fail(String id, String message) {
        PluginCall call = speaking.remove(id);
        if (call != null) call.reject(message);
    }
}
