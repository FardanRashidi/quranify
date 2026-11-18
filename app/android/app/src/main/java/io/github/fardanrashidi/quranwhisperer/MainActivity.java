package io.github.fardanrashidi.quranwhisperer;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WhisperPlugin.class);
        registerPlugin(SpeechPlugin.class);
        registerPlugin(ScreenPlugin.class);
        registerPlugin(AutoSearchPlugin.class);
        registerPlugin(SavedVoicePlugin.class);
        super.onCreate(savedInstanceState);

        // Back goes back in the page's history first (an open settings panel is a
        // step in it), and only leaves the app when there's nowhere left to go back to.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge().getWebView();
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                }
            }
        });
    }

    @Override
    public void onDestroy() {
        // The page that was listening or reading is gone: so is the reason to keep going
        if (isFinishing()) BackgroundService.stop(this);
        super.onDestroy();
    }
}
