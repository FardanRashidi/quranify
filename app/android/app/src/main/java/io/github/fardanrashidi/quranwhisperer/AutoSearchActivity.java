package io.github.fardanrashidi.quranwhisperer;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.List;

/**
 * Starts auto search, from the Quick Settings tile or the app's settings. It has
 * no window of its own: it asks for the microphone (and, on Android 13 and later,
 * notifications) if it needs to, starts AutoSearchService, and closes once the
 * service is running. A service started while no screen of the app is showing
 * isn't allowed the microphone.
 */
public class AutoSearchActivity extends Activity {

    private static final int ASK = 1;
    private static final int WAIT_MS = 50, WAIT_TRIES = 60; // for the service to start: 3 s at most

    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        List<String> missing = new ArrayList<>();
        if (!granted(Manifest.permission.RECORD_AUDIO)) missing.add(Manifest.permission.RECORD_AUDIO);
        if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)) missing.add(Manifest.permission.POST_NOTIFICATIONS);
        if (missing.isEmpty()) start();
        else requestPermissions(missing.toArray(new String[0]), ASK);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (!granted(Manifest.permission.RECORD_AUDIO)) {
            close("Auto search needs the microphone");
        } else if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)) {
            close("Auto search needs notifications, to tell you which surah it hears");
        } else {
            start();
        }
    }

    private void start() {
        Intent service = new Intent(this, AutoSearchService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(service);
        else startService(service);
        waitForService(0);
    }

    // Stays (invisibly) in front until the service has gone into the foreground itself.
    private void waitForService(int tries) {
        if (AutoSearchService.isRunning() || tries >= WAIT_TRIES) close(null);
        else handler.postDelayed(() -> waitForService(tries + 1), WAIT_MS);
    }

    private void close(String message) {
        if (message != null) Toast.makeText(getApplicationContext(), message, Toast.LENGTH_LONG).show();
        finish();
    }

    private boolean granted(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }
}
