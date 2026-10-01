package com.raisethebar.game;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.res.XmlResourceParser;
import android.net.Uri;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.xmlpull.v1.XmlPullParser;

import java.util.List;

/** Launches the app through a full lifecycle, so a crash on startup fails the build. */
@RunWith(RobolectricTestRunner.class)
public class MainActivityTest {

    @Test
    @Config(sdk = 35)
    public void opensFriendCodesAndLegacyReplayLinks() {
        String base = "https://example.com/";
        Intent direct = new Intent(Intent.ACTION_VIEW, Uri.parse(base + "challenge/ABCDEF123456?from=text"));
        assertTrue(MainActivity.gameUrlFor(direct).endsWith("#c=ABCDEF123456"));
        Intent badPath = new Intent(Intent.ACTION_VIEW, Uri.parse(base + "challenge/not-a-challenge"));
        assertFalse(MainActivity.gameUrlFor(badPath).contains("#"));
        Intent friend = new Intent(Intent.ACTION_VIEW, Uri.parse(base + "#c=ABCDEF123456"));
        assertTrue(MainActivity.gameUrlFor(friend).endsWith("#c=ABCDEF123456"));
        Intent replay = new Intent(Intent.ACTION_VIEW, Uri.parse(base + "#r=ABC_xyz-123"));
        assertTrue(MainActivity.gameUrlFor(replay).endsWith("#r=ABC_xyz-123"));
        Intent invalid = new Intent(Intent.ACTION_VIEW, Uri.parse(base + "#c=bad-code"));
        assertFalse(MainActivity.gameUrlFor(invalid).contains("#"));
    }

    @Test
    @Config(sdk = 35)
    public void friendLinksAndReplayLinksBothResolveToTheApp() {
        Uri share = Uri.parse(BuildConfig.SHARE_BASE_URL);
        String friend = "https://" + share.getHost() + "/challenge/ABCDEF123456?from=text";
        assertTrue(resolvesToApp(friend));
        assertTrue(MainActivity.gameUrlFor(viewIntent(friend)).endsWith("#c=ABCDEF123456"));

        String replay = BuildConfig.SHARE_BASE_URL + "#r=ABC_xyz-123";
        assertTrue(resolvesToApp(replay));
        assertTrue(MainActivity.gameUrlFor(viewIntent(replay)).endsWith("#r=ABC_xyz-123"));

        assertFalse(resolvesToApp("https://example.invalid/challenge/ABCDEF123456"));
        String outsideSharePath = "https://" + share.getHost() + "/not-the-game/page";
        String sharePath = share.getPath() == null || share.getPath().isEmpty() ? "/" : share.getPath();
        if (!"/".equals(sharePath) && !"/not-the-game/page".startsWith(sharePath)) {
            assertFalse(resolvesToApp(outsideSharePath));
        }
    }

    @Test
    @Config(sdk = 35)
    public void newIntentReplacesTheActivityIntent() {
        ActivityController<MainActivity> c = Robolectric.buildActivity(MainActivity.class).setup();
        Uri link = Uri.parse("https://" + Uri.parse(BuildConfig.SHARE_BASE_URL).getHost() + "/challenge/ABCDEF123456");
        Intent next = viewIntent(link.toString());
        c.newIntent(next);
        assertTrue(link.equals(c.get().getIntent().getData()));
        assertTrue(MainActivity.gameUrlFor(c.get().getIntent()).endsWith("#c=ABCDEF123456"));
    }

    @Test
    @Config(sdk = 29)
    public void legacyBackupRulesExcludeTheWebViewStore() throws Exception {
        String rules = xmlText(R.xml.backup_rules);
        assertTrue(rules.contains("exclude domain=root path=app_webview"));
        assertTrue(rules.contains("exclude domain=sharedpref path=WebViewChromiumPrefs.xml"));
        assertTrue(rules.contains("exclude domain=database path=webview.db"));
    }

    @Test
    @Config(sdk = 31)
    public void backupAndDeviceTransferExcludeTheWebViewStore() throws Exception {
        String rules = xmlText(R.xml.data_extraction_rules);
        assertTrue(rules.contains("<cloud-backup>"));
        assertTrue(rules.contains("<device-transfer>"));
        int webViewExcludes = 0;
        int from = 0;
        while (true) {
            int at = rules.indexOf("exclude domain=root path=app_webview", from);
            if (at < 0) break;
            webViewExcludes++;
            from = at + 1;
        }
        assertTrue(webViewExcludes >= 2);
    }

    @Test
    @Config(sdk = {29, 30, 33, 34, 35})
    public void launchesAndSurvivesLifecycle() {
        ActivityController<MainActivity> c = Robolectric.buildActivity(MainActivity.class).setup();
        assertNotNull(c.get().getWindow().getDecorView());
        c.pause().stop().start().resume();
        c.configurationChange(c.get().getResources().getConfiguration()); // fold / unfold
        c.pause().stop().destroy();
    }

    private static Intent viewIntent(String url) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addCategory(Intent.CATEGORY_DEFAULT);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        return intent;
    }

    private static boolean resolvesToApp(String url) {
        PackageManager pm = RuntimeEnvironment.getApplication().getPackageManager();
        String packageName = RuntimeEnvironment.getApplication().getPackageName();
        List<ResolveInfo> matches = pm.queryIntentActivities(viewIntent(url), PackageManager.MATCH_ALL);
        for (ResolveInfo info : matches) {
            if (info.activityInfo != null
                    && packageName.equals(info.activityInfo.packageName)
                    && MainActivity.class.getName().equals(info.activityInfo.name)) {
                return true;
            }
        }
        return false;
    }

    private static String xmlText(int resId) throws Exception {
        XmlResourceParser parser = RuntimeEnvironment.getApplication().getResources().getXml(resId);
        StringBuilder text = new StringBuilder();
        int event;
        while ((event = parser.next()) != XmlPullParser.END_DOCUMENT) {
            if (event != XmlPullParser.START_TAG) continue;
            text.append('<').append(parser.getName());
            for (int i = 0; i < parser.getAttributeCount(); i++) {
                String name = parser.getAttributeName(i);
                if (name.contains(":")) name = name.substring(name.indexOf(':') + 1);
                text.append(' ').append(name).append('=').append(parser.getAttributeValue(i));
            }
            text.append('>');
        }
        parser.close();
        return text.toString();
    }
}
