package com.raisethebar.game;

import static org.junit.Assert.assertNotNull;

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
    @Config(sdk = {29, 30, 33, 34, 35})
    public void launchesAndSurvivesLifecycle() {
        ActivityController<MainActivity> c = Robolectric.buildActivity(MainActivity.class).setup();
        assertNotNull(c.get().getWindow().getDecorView());
        c.pause().stop().start().resume();
        c.configurationChange(c.get().getResources().getConfiguration()); // fold / unfold
        c.pause().stop().destroy();
    }
}
