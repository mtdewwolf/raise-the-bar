package com.raisethebar.game;

import android.app.Activity;

/** Direct-distribution builds never contain or invoke Google Play Billing. */
final class PlayBillingManager {
    interface Listener {
        void onBillingUpdate(String state, String message, String formattedPrice);
        void onEntitlementsChanged();
    }

    PlayBillingManager(Activity activity, Listener listener) {}

    void start() {}
    void syncAccount(String accountJson) {}
    void purchase() {}
    void restore() {}
    void destroy() {}
}
