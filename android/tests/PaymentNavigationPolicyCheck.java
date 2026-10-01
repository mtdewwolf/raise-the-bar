package com.raisethebar.game;

/** Runs on a plain JDK so payment-gate checks do not depend on an Android SDK. */
public final class PaymentNavigationPolicyCheck {
    private static int checks;

    public static void main(String[] args) {
        String local = "https://appassets.androidplatform.net/assets/index.html";
        allowDocument(local);
        allowDocument(local + "?t=123#c=abcdef123456");
        blockDocument("https://checkout.stripe.com/c/pay/session");
        blockDocument("https://buy.stripe.com/test_link");
        blockDocument("https://payments.example.com/checkout");
        blockDocument("https://appassets.androidplatform.net/checkout");
        blockDocument("https://appassets.androidplatform.net/assets/%69ndex.html");
        blockDocument("https://appassets.androidplatform.net:443/assets/index.html");
        blockDocument("https://appassets.androidplatform.net.evil.example/assets/index.html");
        blockDocument("https://appassets.androidplatform.net@evil.example/assets/index.html");
        blockDocument("https://user@appassets.androidplatform.net/assets/index.html");
        blockDocument("http://appassets.androidplatform.net/assets/index.html");
        blockDocument("intent://checkout#Intent;scheme=https;end");
        blockDocument("javascript:window.open('https://checkout.stripe.com')");
        blockDocument("file:///android_asset/index.html");
        blockDocument("not a url");
        blockDocument(null);

        blockedResource("https://game.example/api/shop/checkout");
        blockedResource("https://game.example/api/shop/checkout?sku=starter");
        blockedResource("https://game.example/api/shop/checkout/");
        blockedResource("https://game.example/api/shop/%63heckout");
        blockedResource("https://game.example/api/shop/unused/../checkout");
        blockedResource("https://game.example/api/shop/unused/%2e%2e/checkout");
        blockedResource("https://js.stripe.com/v3/");
        blockedResource("https://CHECKOUT.STRIPE.COM/c/pay/session");
        blockedResource("https://checkout.stripe.com./c/pay/session");
        blockedResource("https://stripe.network/image");
        blockedResource("https://images.stripeassets.com/image");
        allowedResource("https://game.example/api/me");
        allowedResource("https://game.example/api/leaderboard");
        allowedResource("https://game.example/api/shop/catalog");
        allowedResource(local);
        System.out.println("Android payment navigation policy: " + checks + " checks passed");
    }

    private static void allowDocument(String url) {
        check(PaymentNavigationPolicy.isLocalGameUrl(url), "Expected local document: " + url);
        check(!PaymentNavigationPolicy.blocksResource(url, true), "Expected local main frame: " + url);
    }

    private static void blockDocument(String url) {
        check(!PaymentNavigationPolicy.isLocalGameUrl(url), "Unexpected allowed document: " + url);
        check(PaymentNavigationPolicy.blocksResource(url, true), "Unexpected allowed main frame: " + url);
    }

    private static void blockedResource(String url) {
        check(PaymentNavigationPolicy.blocksResource(url, false), "Unexpected allowed resource: " + url);
    }

    private static void allowedResource(String url) {
        check(!PaymentNavigationPolicy.blocksResource(url, false), "Unexpected blocked resource: " + url);
    }

    private static void check(boolean value, String message) {
        checks++;
        if (!value) throw new AssertionError(message);
    }
}
