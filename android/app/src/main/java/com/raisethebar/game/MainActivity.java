package com.raisethebar.game;

import android.app.Activity;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackAnimationCallback;
import android.window.OnBackInvokedDispatcher;

import androidx.core.content.ContextCompat;
import androidx.core.util.Consumer;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewFeature;
import androidx.window.java.layout.WindowInfoTrackerCallbackAdapter;
import androidx.window.layout.DisplayFeature;
import androidx.window.layout.FoldingFeature;
import androidx.window.layout.WindowInfoTracker;
import androidx.window.layout.WindowLayoutInfo;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.json.JSONObject;

/**
 * Hosts the browser game (index.html, copied into assets at build time) in a full-screen WebView.
 * The game is served from https://appassets.androidplatform.net so it gets a secure origin with
 * working localStorage, exactly like the hosted web version.
 */
public class MainActivity extends Activity {

    private static final String GAME_ORIGIN = "https://" + WebViewAssetLoader.DEFAULT_DOMAIN;
    private static final String GAME_URL = GAME_ORIGIN + "/assets/index.html";
    private static final Pattern REPLAY_CODE = Pattern.compile("(?:^|&)(r=[A-Za-z0-9_-]+|c=[A-Fa-f0-9]{12})(?:&|$)");

    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private WindowInfoTrackerCallbackAdapter windowInfo;
    private final Consumer<WindowLayoutInfo> layoutListener = this::onWindowLayout;
    private String foldArgs = "null"; // last hinge position sent to the game
    private long lastRendererLoss;
    private PlayBillingManager playBilling;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        createWebView();
        playBilling = new PlayBillingManager(this, new PlayBillingManager.Listener() {
            @Override
            public void onBillingUpdate(String state, String message, String formattedPrice) {
                sendBillingUpdate(state, message, formattedPrice);
            }

            @Override
            public void onEntitlementsChanged() {
                runOnUiThread(() -> {
                    if (webView != null) {
                        webView.evaluateJavascript(
                                "window.rtbPlayBillingEntitlementsChanged&&window.rtbPlayBillingEntitlementsChanged()",
                                null);
                    }
                });
            }
        });
        enterImmersive(); // needs the decor view that setContentView creates (crashes before it on Android 11+)
        windowInfo = new WindowInfoTrackerCallbackAdapter(WindowInfoTracker.getOrCreate(this));

        // API 36 does not deliver onBackPressed or KEYCODE_BACK. The callback is the back path.
        if (Build.VERSION.SDK_INT >= 34) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, new OnBackAnimationCallback() {
                        @Override
                        public void onBackInvoked() {
                            handleBack();
                        }
                    });
        } else if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null
                || !PaymentNavigationPolicy.isLocalGameUrl(webView.getUrl())) {
            webView.loadUrl(gameUrlFor(getIntent()));
        }
    }

    private void createWebView() {
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
        // No onCreateWindow handler: popup and target=_blank requests are denied.
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setTextZoom(100);                      // ignore the system font size; the HUD is laid out in px

        webView.addJavascriptInterface(new GameBridge(), "RTBAndroid");
        if (BuildConfig.PLAY_BILLING_ENABLED
                && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "RTBPlayBilling",
                    Collections.singleton(GAME_ORIGIN),
                    (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                        if (!isMainFrame || !isGameOrigin(sourceOrigin)
                                || message.getType() != WebMessageCompat.TYPE_STRING) return;
                        handlePlayBillingMessage(message.getData());
                    });
        }
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (PaymentNavigationPolicy.blocksResource(request.getUrl().toString(), request.isForMainFrame())) {
                    return blockedWebCheckout();
                }
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                sendFold();
                if (BuildConfig.PLAY_BILLING_ENABLED) {
                    view.evaluateJavascript("(function(){if(document.getElementById('rtb-play-billing-bridge'))return;"
                            + "var s=document.createElement('script');s.id='rtb-play-billing-bridge';"
                            + "s.src='/assets/play-billing-bridge.js';document.head.appendChild(s)})()", null);
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // The game's renderer crashed or was killed to free memory. Without this the whole
                // app would be killed with it; instead start a fresh WebView and reload the game.
                recoverFromRendererLoss();
                return true;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Never route checkout to a remote document, external browser or intent.
                return !PaymentNavigationPolicy.isLocalGameUrl(request.getUrl().toString());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !PaymentNavigationPolicy.isLocalGameUrl(url);
            }
        });
        setContentView(webView);
    }

    private void recoverFromRendererLoss() {
        long now = System.currentTimeMillis();
        if (now - lastRendererLoss < 10_000) { // crashing on every load: give up quietly
            finish();
            return;
        }
        lastRendererLoss = now;
        WebView dead = webView;
        createWebView();
        dead.destroy();
        webView.loadUrl(GAME_URL);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // After process death Android redelivers getIntent(), not the previous onNewIntent argument.
        setIntent(intent);
        String code = replayCode(intent);
        // A changed query string forces a real reload so the game reads the new challenge invite.
        if (code != null) webView.loadUrl(GAME_URL + "?t=" + System.currentTimeMillis() + "#" + code);
    }

    /** The game URL, carrying the challenge from a shared link the app was opened with. */
    static String gameUrlFor(Intent intent) {
        String code = replayCode(intent);
        return code == null ? GAME_URL : GAME_URL + "#" + code;
    }

    private static String replayCode(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return null;
        String path = intent.getData().getPath();
        if (path != null && path.matches("/challenge/[A-Fa-f0-9]{12}")) {
            return "c=" + path.substring("/challenge/".length());
        }
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
    @SuppressLint("GestureBackNavigation") // API 33+ is handled by the registered OnBackInvokedCallback above.
    public void onBackPressed() {
        handleBack(); // API 32 and older. API 33+ uses the callback; API 36 never calls this.
    }

    private static WebResourceResponse blockedWebCheckout() {
        byte[] message = "Web checkout is unavailable in this Android app.".getBytes(StandardCharsets.UTF_8);
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden",
                Collections.emptyMap(), new ByteArrayInputStream(message));
    }

    private static boolean isGameOrigin(Uri origin) {
        return origin != null
                && "https".equalsIgnoreCase(origin.getScheme())
                && WebViewAssetLoader.DEFAULT_DOMAIN.equalsIgnoreCase(origin.getHost())
                && origin.getPort() == -1;
    }

    private void handlePlayBillingMessage(String raw) {
        if (raw == null || raw.length() > 10_000) return;
        try {
            JSONObject message = new JSONObject(raw);
            String action = message.optString("action", "");
            JSONObject account = message.optJSONObject("account");
            String accountJson = account == null ? "{}" : account.toString();
            runOnUiThread(() -> {
                playBilling.syncAccount(accountJson);
                if ("purchase".equals(action)) playBilling.purchase();
                else if ("restore".equals(action)) playBilling.restore();
            });
        } catch (Exception ignored) {
            // Malformed messages from the page fail closed and never reach BillingClient.
        }
    }

    @SuppressWarnings("deprecation")
    private void enterImmersive() {
        Window w = getWindow();
        // Target 36 cannot opt out of edge-to-edge. Keep the game under the system bars and hide them.
        if (Build.VERSION.SDK_INT >= 29) {
            w.setStatusBarContrastEnforced(false);
            w.setNavigationBarContrastEnforced(false);
        }
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
    protected void onStart() {
        super.onStart();
        windowInfo.addWindowLayoutInfoListener(this, ContextCompat.getMainExecutor(this), layoutListener);
        playBilling.start();
    }

    @Override
    protected void onStop() {
        windowInfo.removeWindowLayoutInfoListener(layoutListener);
        super.onStop();
    }

    /**
     * Flex mode: when a foldable is half open with a horizontal hinge (tabletop), tell the game where
     * the hinge is so it keeps the climb above the fold and turns the lower half into a controller.
     */
    private void onWindowLayout(WindowLayoutInfo info) {
        String args = "null";
        for (DisplayFeature f : info.getDisplayFeatures()) {
            if (f instanceof FoldingFeature fold
                    && fold.getState() == FoldingFeature.State.HALF_OPENED
                    && fold.getOrientation() == FoldingFeature.Orientation.HORIZONTAL) {
                Rect b = fold.getBounds(); // window coordinates, in physical pixels
                int[] loc = new int[2];
                webView.getLocationInWindow(loc);
                float density = getResources().getDisplayMetrics().density; // CSS px -> physical px
                args = ((b.top - loc[1]) / density) + "," + ((b.bottom - loc[1]) / density);
            }
        }
        foldArgs = args;
        sendFold();
    }

    private void sendFold() {
        webView.evaluateJavascript("window.rtbSetFold && window.rtbSetFold(" + foldArgs + ")", null);
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
        playBilling.start(); // catches completed pending purchases after returning to foreground
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        playBilling.destroy();
        webView.destroy();
        super.onDestroy();
    }

    private void sendBillingUpdate(String state, String message, String formattedPrice) {
        JSONObject update = new JSONObject();
        try {
            update.put("state", state);
            update.put("message", message);
            if (formattedPrice != null) update.put("formattedPrice", formattedPrice);
        } catch (Exception ignored) {
            return;
        }
        String script = "window.rtbPlayBillingUpdate&&window.rtbPlayBillingUpdate(" + update + ")";
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript(script, null);
        });
    }

    /** Exposed to the game as window.RTBAndroid. Called on a WebView background thread. */
    final class GameBridge {
        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public boolean supportsWebCheckout() {
            return false;
        }

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
