package io.github.fardanrashidi.quranwhisperer;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.view.WindowManager;
import android.webkit.WebView;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keeps the screen on for app/src/api.js while it's listening or reading aloud, and
 * keeps them going if the screen goes off anyway (BackgroundService).
 */
@CapacitorPlugin(name = "Screen")
public class ScreenPlugin extends Plugin {

    private static volatile ScreenPlugin instance;
    private boolean askedForNotifications;

    @Override
    public void load() {
        instance = this;
    }

    /** The notification's Stop: tells the page ("stop" event). */
    static void stopFromNotification() {
        ScreenPlugin plugin = instance;
        if (plugin != null) plugin.notifyListeners("stop", null);
    }

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

    /**
     * { listening, reading, text }: what's going on, to keep going with the screen off,
     * and what the notification says about it. Both false stops it.
     */
    @PluginMethod
    public void keepRunning(PluginCall call) {
        boolean listening = Boolean.TRUE.equals(call.getBoolean("listening", false));
        boolean reading = Boolean.TRUE.equals(call.getBoolean("reading", false));
        boolean on = listening || reading;
        if (on) {
            askForNotifications();
            BackgroundService.update(getContext(), listening, reading, call.getString("text", ""));
        } else {
            BackgroundService.stop(getContext());
        }
        // The WebView lets its page's process drop to the background's priority when it
        // can't be seen, and Android then freezes it: no more checks, and no reading the
        // next ayah. Meanwhile, it keeps its priority with the screen off too.
        if (Build.VERSION.SDK_INT >= 26) {
            WebView webView = getBridge().getWebView();
            webView.post(() -> webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, !on));
        }
        call.resolve();
    }

    // Android 13 and later only shows the notification (that it's running, and its Stop) once it's allowed to.
    private void askForNotifications() {
        if (Build.VERSION.SDK_INT < 33 || askedForNotifications) return;
        askedForNotifications = true;
        if (getContext().checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        Activity activity = getActivity();
        activity.runOnUiThread(() -> activity.requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 7));
    }
}
