package io.github.fardanrashidi.quranwhisperer;

import android.app.StatusBarManager;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Auto search (AutoSearchService) for app/src/api.js: whether it's on, turning it
 * on and off, adding its Quick Settings tile, and an "open" event ({ surah, ayah })
 * when the app is opened from one of its notifications.
 */
@CapacitorPlugin(name = "AutoSearch")
public class AutoSearchPlugin extends Plugin {

    @Override
    public void load() {
        opened(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        opened(intent);
    }

    private void opened(Intent intent) {
        if (intent == null || !intent.hasExtra(AutoSearchService.EXTRA_SURAH)) return;
        JSObject place = new JSObject();
        place.put("surah", intent.getIntExtra(AutoSearchService.EXTRA_SURAH, 1));
        place.put("ayah", intent.getIntExtra(AutoSearchService.EXTRA_AYAH, 1));
        // So that reloading the page doesn't open it again
        intent.removeExtra(AutoSearchService.EXTRA_SURAH);
        intent.removeExtra(AutoSearchService.EXTRA_AYAH);
        notifyListeners("open", place, true); // kept until the page is listening
    }

    /** → { running, canAddTile } */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("running", AutoSearchService.isRunning());
        result.put("canAddTile", Build.VERSION.SDK_INT >= 33);
        call.resolve(result);
    }

    /** Through AutoSearchActivity, which asks for the permissions it needs. */
    @PluginMethod
    public void start(PluginCall call) {
        getActivity().startActivity(new Intent(getContext(), AutoSearchActivity.class));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), AutoSearchService.class));
        call.resolve();
    }

    /** Android 13+ asks the user to add the tile → { result: added | already | declined | error } */
    @PluginMethod
    public void addTile(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33) {
            call.reject("this version of Android can't add a tile from an app");
            return;
        }
        StatusBarManager bar = getContext().getSystemService(StatusBarManager.class);
        bar.requestAddTileService(
            new ComponentName(getContext(), AutoSearchTile.class),
            getContext().getString(R.string.auto_search_tile),
            Icon.createWithResource(getContext(), R.drawable.ic_auto_search),
            getContext().getMainExecutor(),
            code -> {
                JSObject result = new JSObject();
                result.put(
                    "result",
                    code == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED
                        ? "added"
                        : code == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED
                            ? "already"
                            : code == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_NOT_ADDED ? "declined" : "error"
                );
                call.resolve(result);
            }
        );
    }
}
