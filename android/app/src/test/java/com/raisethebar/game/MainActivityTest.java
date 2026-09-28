package com.raisethebar.game;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertFalse;
import android.content.Intent;
import android.net.Uri;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;

/** Launches the app through a full lifecycle, so a crash on startup fails the build. */
@RunWith(RobolectricTestRunner.class)
public class MainActivityTest {

    @Test
    @Config(sdk = 35)
    public void opensFriendCodesAndLegacyReplayLinks() {
        String base = "https://example.com/";
        Intent friend = new Intent(Intent.ACTION_VIEW, Uri.parse(base + "#c=ABCDEF123456"));
        assertTrue(MainActivity.gameUrlFor(friend).endsWith("#c=ABCDEF123456"));
        Intent replay = new Intent(Intent.ACTION_VIEW, Uri.parse(base + "#r=ABC_xyz-123"));
        assertTrue(MainActivity.gameUrlFor(replay).endsWith("#r=ABC_xyz-123"));
        Intent invalid = new Intent(Intent.ACTION_VIEW, Uri.parse(base + "#c=bad-code"));
        assertFalse(MainActivity.gameUrlFor(invalid).contains("#"));
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
}
