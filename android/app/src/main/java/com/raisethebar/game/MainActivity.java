package com.raisethebar.game;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedDispatcher;

import androidx.webkit.WebViewAssetLoader;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Hosts the browser game (index.html, copied into assets at build time) in a full-screen WebView.
 * The game is served from https://appassets.androidplatform.net so it gets a secure origin with
 * working localStorage, exactly like the hosted web version.
 */
public class MainActivity extends Activity {

    private static final String GAME_URL = "https://" + WebViewAssetLoader.DEFAULT_DOMAIN + "/assets/index.html";
    private static final Pattern REPLAY_CODE = Pattern.compile("(?:^|&)r=([A-Za-z0-9_-]+)");

    private WebView webView;
    private WebViewAssetLoader assetLoader;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        enterImmersive();

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView = new WebView(this);
        webView.setBackgroundColor(getColor(R.color.sky));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setHapticFeedbackEnabled(false);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);            // best height, daily ghost, tutorial flag
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);                      // ignore the system font size; the HUD is laid out in px

        webView.addJavascriptInterface(new GameBridge(), "RTBAndroid");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (WebViewAssetLoader.DEFAULT_DOMAIN.equals(url.getHost())) return false;
                openExternally(url);
                return true;
            }
        });
        setContentView(webView);

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(gameUrlFor(getIntent()));
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String code = replayCode(intent);
        // A changed query string forces a real reload so the game reads the new #r= challenge.
        if (code != null) webView.loadUrl(GAME_URL + "?t=" + System.currentTimeMillis() + "#r=" + code);
    }

    /** The game URL, carrying the challenge from a shared link the app was opened with. */
    private static String gameUrlFor(Intent intent) {
        String code = replayCode(intent);
        return code == null ? GAME_URL : GAME_URL + "#r=" + code;
    }

    private static String replayCode(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return null;
        String fragment = intent.getData().getFragment();
        if (fragment == null) return null;
        Matcher m = REPLAY_CODE.matcher(fragment);
        return m.find() ? m.group(1) : null;
    }

    /** Back pauses the climb, then leaves to the menu; from the menu it exits the app. */
    private void handleBack() {
        webView.evaluateJavascript("!!(window.rtbBack && window.rtbBack())", handled -> {
            if (!"true".equals(handled)) finish();
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack(); // Android 12L and older; newer versions use the OnBackInvokedCallback above
    }

    private void openExternally(Uri url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    @SuppressWarnings("deprecation")
    private void enterImmersive() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersive();
    }

    @Override
    protected void onPause() {
        super.onPause();
        webView.onPause(); // the game pauses itself on visibilitychange
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }

    /** Exposed to the game as window.RTBAndroid. Called on a WebView background thread. */
    final class GameBridge {
        @JavascriptInterface
        public String shareBaseUrl() {
            return BuildConfig.SHARE_BASE_URL;
        }

        @JavascriptInterface
        public void share(String text, String url) {
            Intent send = new Intent(Intent.ACTION_SEND)
                    .setType("text/plain")
                    .putExtra(Intent.EXTRA_SUBJECT, getString(R.string.app_name))
                    .putExtra(Intent.EXTRA_TEXT, text + " " + url);
            runOnUiThread(() -> startActivity(Intent.createChooser(send, getString(R.string.share_title))));
        }
    }
}
