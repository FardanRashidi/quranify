package io.github.fardanrashidi.quranwhisperer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;
import androidx.core.app.NotificationCompat;

/**
 * Keeps the page's Listen going with the screen off, or the app in the background.
 * The page records through the WebView, and Android only lets an app that isn't on
 * screen keep using the microphone while it has a foreground service of the
 * microphone type, so this is one: it does nothing but hold the notification and a
 * wake lock, from when Listen starts until it stops (ScreenPlugin starts and stops it).
 */
public class ListeningService extends Service {

    private static final String TAG = "Listening";
    private static final String CHANNEL = "listening";
    private static final int ID = 3; // AutoSearchService has 1 and 2

    private PowerManager.WakeLock wakeLock;

    static void start(Context context) {
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(new Intent(context, ListeningService.class));
            else context.startService(new Intent(context, ListeningService.class));
        } catch (RuntimeException e) {
            Log.w(TAG, "couldn't start", e); // listening still works while the app's on screen
        }
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, ListeningService.class));
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            if (Build.VERSION.SDK_INT >= 30) startForeground(ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(ID, notification());
        } catch (RuntimeException e) {
            // Not allowed from the background (or no microphone permission yet)
            Log.w(TAG, "couldn't go into the foreground", e);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (wakeLock == null) {
            wakeLock = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "quranwhisperer:listening");
            wakeLock.acquire();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        super.onDestroy();
    }

    private Notification notification() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Listening", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shows while Listen is on, so it keeps going with the screen off");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
        Intent back = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent open = PendingIntent.getActivity(this, 1, back, PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_auto_search)
            .setContentTitle("Listening")
            .setContentText("Following the recitation. Tap to go back to it.")
            .setContentIntent(open)
            .setOngoing(true)
            .setSilent(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }
}
