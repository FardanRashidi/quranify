package io.github.fardanrashidi.quranfinder;

import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/** The Quick Settings tile that turns auto search (AutoSearchService) on and off. */
public class AutoSearchTile extends TileService {

    @Override
    public void onStartListening() {
        show(AutoSearchService.isRunning());
    }

    @Override
    @SuppressWarnings("deprecation") // startActivityAndCollapse(Intent), for Android 13 and earlier
    public void onClick() {
        if (AutoSearchService.isRunning()) {
            stopService(new Intent(this, AutoSearchService.class));
            show(false);
            return;
        }
        // Started from here, the service wouldn't be allowed the microphone. AutoSearchActivity,
        // which has no window, starts it instead, and asks for the permissions it needs first.
        Intent intent = new Intent(this, AutoSearchActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE));
        } else {
            startActivityAndCollapse(intent);
        }
    }

    private void show(boolean on) {
        Tile tile = getQsTile();
        if (tile == null) return;
        tile.setState(on ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        if (Build.VERSION.SDK_INT >= 29) tile.setSubtitle(on ? AutoSearchService.status() : "Off");
        tile.updateTile();
    }

    /** Asks for the tile to be brought up to date: auto search started, stopped, or found something. */
    static void refresh(Context context) {
        try {
            requestListeningState(context, new ComponentName(context, AutoSearchTile.class));
        } catch (RuntimeException ignored) {
            // not in Quick Settings
        }
    }
}
