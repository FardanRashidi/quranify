package io.github.fardanrashidi.quranwhisperer;

import android.app.Activity;
import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keeps the screen on for app/src/api.js while it's listening or reading aloud, and
 * keeps listening going if the screen goes off anyway (ListeningService).
 */
@CapacitorPlugin(name = "Screen")
public class ScreenPlugin extends Plugin {

    /** { on } */
    @PluginMethod
    public void keepOn(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            if (on) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    /** { on }: whether Listen is on, so the microphone keeps working with the screen off */
    @PluginMethod
    public void keepListening(PluginCall call) {
        if (Boolean.TRUE.equals(call.getBoolean("on", false))) ListeningService.start(getContext());
        else ListeningService.stop(getContext());
        call.resolve();
    }
}
