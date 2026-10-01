package com.raisethebar.game;

import android.app.Activity;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryProductDetailsResult;
import com.android.billingclient.api.QueryPurchasesParams;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Play Store implementation for the permanent Supporter cosmetic. */
final class PlayBillingManager implements PurchasesUpdatedListener {
    interface Listener {
        void onBillingUpdate(String state, String message, String formattedPrice);
        void onEntitlementsChanged();
    }

    private static final String VERIFY_PATH = "/api/shop/google-play/verify";
    private static final String RECONCILE_PATH = "/api/shop/google-play/reconcile";

    private final Activity activity;
    private final Listener listener;
    private final BillingClient client;
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final Set<String> verificationInFlight = Collections.synchronizedSet(new HashSet<>());

    private volatile AccountContext account;
    private volatile AccountContext purchaseAccount;
    private volatile ProductDetails product;
    private boolean connecting;
    private boolean flowInFlight;
    private boolean destroyed;

    PlayBillingManager(Activity activity, Listener listener) {
        this.activity = activity;
        this.listener = listener;
        client = BillingClient.newBuilder(activity)
                .setListener(this)
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .enableAutoServiceReconnection()
                .build();
    }

    void start() {
        if (destroyed) return;
        if (!configured()) {
            update("unavailable", "Google Play purchases are not configured for this build.", null);
            return;
        }
        if (client.isReady()) {
            queryProduct();
            queryPurchases(false);
            return;
        }
        if (connecting) return;
        connecting = true;
        update("connecting", "Connecting to Google Play.", null);
        client.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult result) {
                connecting = false;
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    queryProduct();
                    queryPurchases(false);
                } else {
                    unavailable(result, "Google Play Billing is unavailable.");
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                connecting = false; // automatic reconnection runs on the next Billing API call
                update("unavailable", "Google Play disconnected. Reopen the account panel to retry.", null);
            }
        });
    }

    void syncAccount(String accountJson) {
        AccountContext parsed = AccountContext.parse(accountJson);
        account = parsed;
        if (parsed == null) purchaseAccount = null;
        // Refresh ProductDetails after the page installs its callback; an earlier lifecycle
        // connection may have completed before JavaScript was ready to receive the price.
        if (client.isReady()) {
            queryProduct();
            if (parsed != null) queryPurchases(false);
        }
    }

    void purchase() {
        AccountContext current = account;
        if (flowInFlight) return;
        if (current == null || !current.recoveryConfirmed) {
            update("unavailable", "Sign in and confirm your recovery code before buying.", null);
            return;
        }
        if (!client.isReady()) {
            start();
            return;
        }
        // ProductDetails should be queried near launch; stale objects can make Play reject the flow.
        queryProduct(true, current);
    }

    void restore() {
        if (account == null) {
            update("unavailable", "Sign in before restoring purchases.", null);
            return;
        }
        if (!client.isReady()) {
            start();
            return;
        }
        update("verifying", "Checking Google Play purchases with the server.", formattedPrice());
        queryPurchases(true);
    }

    void destroy() {
        destroyed = true;
        network.shutdownNow();
        if (client.isReady() || connecting) client.endConnection();
    }

    private boolean configured() {
        return PlayBillingPolicy.isSecureBackend(BuildConfig.RTB_API_BASE_URL)
                && PlayBillingPolicy.isValidProductId(BuildConfig.PLAY_SUPPORTER_PRODUCT_ID);
    }

    private void queryProduct() {
        queryProduct(false, null);
    }

    private void queryProduct(boolean launchAfter, AccountContext launchAccount) {
        QueryProductDetailsParams.Product query = QueryProductDetailsParams.Product.newBuilder()
                .setProductId(BuildConfig.PLAY_SUPPORTER_PRODUCT_ID)
                .setProductType(BillingClient.ProductType.INAPP)
                .build();
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                .setProductList(Collections.singletonList(query))
                .build();
        client.queryProductDetailsAsync(params, (result, detailsResult) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                unavailable(result, "The Google Play product is unavailable.");
                return;
            }
            ProductDetails found = findConfiguredProduct(detailsResult);
            if (found == null || offer(found) == null) {
                product = null;
                update("unavailable", "The Supporter cosmetic is not available from Google Play.", null);
                return;
            }
            product = found;
            if (launchAfter) launch(found, launchAccount);
            else update("ready", "Ready to buy securely with Google Play.", formattedPrice());
        });
    }

    private ProductDetails findConfiguredProduct(QueryProductDetailsResult result) {
        for (ProductDetails detail : result.getProductDetailsList()) {
            if (BuildConfig.PLAY_SUPPORTER_PRODUCT_ID.equals(detail.getProductId())
                    && BillingClient.ProductType.INAPP.equals(detail.getProductType())) return detail;
        }
        return null;
    }

    private ProductDetails.OneTimePurchaseOfferDetails offer(ProductDetails details) {
        List<ProductDetails.OneTimePurchaseOfferDetails> offers = details.getOneTimePurchaseOfferDetailsList();
        return offers == null || offers.isEmpty() ? null : offers.get(0);
    }

    private String formattedPrice() {
        ProductDetails current = product;
        ProductDetails.OneTimePurchaseOfferDetails offer = current == null ? null : offer(current);
        return offer == null ? null : offer.getFormattedPrice();
    }

    private void launch(ProductDetails details, AccountContext current) {
        if (current == null || current != account || flowInFlight) {
            update("unavailable", "Your account changed. Try the purchase again.", formattedPrice());
            return;
        }
        ProductDetails.OneTimePurchaseOfferDetails offer = offer(details);
        if (offer == null) {
            update("unavailable", "The Google Play offer is unavailable.", null);
            return;
        }
        BillingFlowParams.ProductDetailsParams item = BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(details)
                .setOfferToken(offer.getOfferToken())
                .build();
        BillingFlowParams params = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(Collections.singletonList(item))
                .setObfuscatedAccountId(PlayBillingPolicy.accountBinding(current.username))
                .build();
        flowInFlight = true;
        purchaseAccount = current;
        BillingResult result = client.launchBillingFlow(activity, params);
        if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
            flowInFlight = false;
            if (result.getResponseCode() == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
                update("verifying", "Already owned. Verifying the purchase with the server.", formattedPrice());
                queryPurchases(true);
            } else {
                unavailable(result, "Google Play could not start the purchase.");
            }
        }
    }

    @Override
    public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        flowInFlight = false;
        if (result.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
            purchaseAccount = null;
            update("ready", "Purchase canceled. Nothing was unlocked.", formattedPrice());
        } else if (result.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) {
            AccountContext owner = purchaseAccount != null ? purchaseAccount : account;
            purchaseAccount = null;
            processPurchases(purchases, owner, true);
        } else if (result.getResponseCode() == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
            queryPurchases(true);
        } else {
            purchaseAccount = null;
            unavailable(result, "Google Play did not complete the purchase.");
        }
    }

    private void queryPurchases(boolean requestedByUser) {
        QueryPurchasesParams params = QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.INAPP)
                .build();
        client.queryPurchasesAsync(params, (result, purchases) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                if (requestedByUser) unavailable(result, "Google Play purchases could not be restored.");
                return;
            }
            AccountContext current = account;
            if (purchases.isEmpty()) {
                if (requestedByUser) {
                    update("verifying", "No active device purchase was found. Reconciling server entitlements.", formattedPrice());
                    reconcileWithBackend(current);
                }
                return;
            }
            processPurchases(purchases, current, requestedByUser);
            if (requestedByUser) reconcileWithBackend(current);
        });
    }

    private void processPurchases(List<Purchase> purchases, AccountContext owner, boolean notify) {
        boolean matched = false;
        for (Purchase purchase : purchases) {
            if (!purchase.getProducts().contains(BuildConfig.PLAY_SUPPORTER_PRODUCT_ID)) continue;
            matched = true;
            if (purchase.getPurchaseState() == Purchase.PurchaseState.PENDING) {
                update("pending", "Payment is pending in Google Play. The cosmetic will unlock only after payment and server verification.", formattedPrice());
            } else if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                verifyWithBackend(purchase, owner);
            }
        }
        if (!matched && notify) {
            update("ready", "No active Supporter purchase was found. Checking server entitlements.", formattedPrice());
            listener.onEntitlementsChanged();
        }
    }

    private void verifyWithBackend(Purchase purchase, AccountContext owner) {
        if (owner == null || account == null || !owner.sameAccount(account)) {
            update("unavailable", "Sign in to the purchasing account to verify this purchase.", formattedPrice());
            return;
        }
        String token = purchase.getPurchaseToken();
        if (token == null || token.isBlank() || !verificationInFlight.add(token)) return;
        update("verifying", "Purchase received. Waiting for secure server verification.", formattedPrice());
        network.execute(() -> {
            try {
                if (!verifyRequest(token, owner)) {
                    update("unavailable", "The server did not verify this Google Play purchase. Nothing was unlocked.", formattedPrice());
                    return;
                }
                activity.runOnUiThread(() -> acknowledgeAfterGrant(purchase));
            } catch (Exception ignored) {
                update("unavailable", "Purchase verification could not reach the server. Use Restore purchases to retry.", formattedPrice());
            } finally {
                verificationInFlight.remove(token);
            }
        });
    }

    private boolean verifyRequest(String purchaseToken, AccountContext owner) throws Exception {
        HttpURLConnection connection = openAuthenticated(VERIFY_PATH, owner);
        JSONObject body = new JSONObject()
                .put("sku", PlayBillingPolicy.SKU)
                .put("productId", BuildConfig.PLAY_SUPPORTER_PRODUCT_ID)
                .put("purchaseToken", purchaseToken)
                .put("packageName", activity.getPackageName());
        JSONObject json = postJson(connection, body);
        if (json == null || !json.optBoolean("purchaseVerified", false)) return false;
        return hasEntitlement(json);
    }

    private void reconcileWithBackend(AccountContext owner) {
        if (owner == null || account == null || !owner.sameAccount(account)) {
            update("unavailable", "Sign in before reconciling Google Play purchases.", formattedPrice());
            return;
        }
        network.execute(() -> {
            try {
                JSONObject response = postJson(openAuthenticated(RECONCILE_PATH, owner), new JSONObject());
                if (response == null) {
                    update("unavailable", "The server could not reconcile Google Play purchases.", formattedPrice());
                    return;
                }
                listener.onEntitlementsChanged();
                update("ready", hasEntitlement(response)
                        ? "Server reconciliation restored the Supporter cosmetic."
                        : "Google Play purchases reconciled. No active Supporter entitlement was found.", formattedPrice());
            } catch (Exception ignored) {
                update("unavailable", "Purchase reconciliation could not reach the server. Try again later.", formattedPrice());
            }
        });
    }

    private HttpURLConnection openAuthenticated(String path, AccountContext owner) throws Exception {
        URI base = new URI(BuildConfig.RTB_API_BASE_URL);
        String prefix = base.toString().replaceAll("/+$", "");
        URL url = new URL(prefix + path);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(15_000);
        connection.setRequestMethod("POST");
        connection.setRequestProperty("Authorization", "Bearer " + owner.token);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setRequestProperty("Accept", "application/json");
        connection.setDoOutput(true);
        return connection;
    }

    private static JSONObject postJson(HttpURLConnection connection, JSONObject body) throws Exception {
        try (OutputStream out = connection.getOutputStream()) {
            out.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300
                ? connection.getInputStream() : connection.getErrorStream();
        String response = readLimited(stream, 64 * 1024);
        connection.disconnect();
        return status >= 200 && status < 300 ? new JSONObject(response) : null;
    }

    private static boolean hasEntitlement(JSONObject json) {
        JSONArray inventory = json.optJSONArray("inventory");
        if (inventory == null) inventory = json.optJSONArray("entitlements");
        if (inventory == null) return false;
        for (int i = 0; i < inventory.length(); i++) {
            if (PlayBillingPolicy.ENTITLEMENT.equals(inventory.optString(i))) return true;
        }
        return false;
    }

    private static String readLimited(InputStream stream, int limit) throws Exception {
        if (stream == null) return "";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            char[] buffer = new char[2048];
            int read;
            while ((read = reader.read(buffer)) != -1) {
                if (result.length() + read > limit) throw new IllegalStateException("Response too large");
                result.append(buffer, 0, read);
            }
        }
        return result.toString();
    }

    private void acknowledgeAfterGrant(Purchase purchase) {
        listener.onEntitlementsChanged();
        if (purchase.isAcknowledged()) {
            update("verified", "Purchase verified. The Supporter cosmetic is restored.", formattedPrice());
            return;
        }
        AcknowledgePurchaseParams params = AcknowledgePurchaseParams.newBuilder()
                .setPurchaseToken(purchase.getPurchaseToken())
                .build();
        client.acknowledgePurchase(params, result -> {
            if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                update("verified", "Purchase verified. The Supporter cosmetic is restored.", formattedPrice());
            } else {
                update("verifying", "Purchase granted, but Google Play acknowledgement will be retried.", formattedPrice());
            }
        });
    }

    private void unavailable(BillingResult result, String fallback) {
        // Debug messages can help testers but never include credentials or purchase tokens.
        String detail = result.getDebugMessage();
        update("unavailable", detail == null || detail.isBlank() ? fallback : fallback + " " + detail, formattedPrice());
    }

    private void update(String state, String message, String price) {
        activity.runOnUiThread(() -> {
            if (!destroyed) listener.onBillingUpdate(state, message, price);
        });
    }

    private static final class AccountContext {
        final String token;
        final String username;
        final boolean recoveryConfirmed;

        AccountContext(String token, String username, boolean recoveryConfirmed) {
            this.token = token;
            this.username = username;
            this.recoveryConfirmed = recoveryConfirmed;
        }

        static AccountContext parse(String raw) {
            try {
                JSONObject value = new JSONObject(raw == null ? "{}" : raw);
                String token = value.optString("token", "");
                String username = value.optString("username", "");
                if (token.isBlank() || username.isBlank() || token.length() > 4096 || username.length() > 64) return null;
                return new AccountContext(token, username, value.optBoolean("recoveryConfirmed", false));
            } catch (Exception ignored) {
                return null;
            }
        }

        boolean sameAccount(AccountContext other) {
            return other != null && username.equals(other.username) && token.equals(other.token);
        }
    }
}
