# Methods called from the game's JavaScript through addJavascriptInterface.
-keepclassmembers class com.raisethebar.game.MainActivity$GameBridge {
    @android.webkit.JavascriptInterface <methods>;
}
