package com.raisethebar.game;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** Fail-closed until a separately verified native Play Billing flow is implemented. */
final class PaymentNavigationPolicy {
    private static final String ASSET_HOST = "appassets.androidplatform.net";

    private PaymentNavigationPolicy() {}

    static boolean isLocalGameUrl(String rawUrl) {
        URI url = parse(rawUrl);
        return url != null
                && "https".equalsIgnoreCase(url.getScheme())
                && ASSET_HOST.equalsIgnoreCase(url.getHost())
                && url.getRawUserInfo() == null
                && url.getPort() == -1
                && "/assets/index.html".equals(url.getRawPath());
    }

    static boolean blocksResource(String rawUrl, boolean mainFrame) {
        if (mainFrame) return !isLocalGameUrl(rawUrl);
        URI url = parse(rawUrl);
        if (url == null) return true;
        String host = url.getHost();
        if (host != null) {
            host = host.toLowerCase(Locale.ROOT);
            if (host.endsWith(".")) host = host.substring(0, host.length() - 1);
            if (isHost(host, "stripe.com") || isHost(host, "stripe.network")
                    || isHost(host, "stripeassets.com")) return true;
        }
        String path = url.getPath();
        if (path != null) {
            try {
                // Decode before normalizing so escaped dot segments cannot evade the gate.
                path = new URI(null, null, path, null).normalize().getPath();
            } catch (URISyntaxException ignored) {
                return true;
            }
        }
        // Do not even create a web checkout session from the Android client.
        return path != null && (path.equals("/api/shop/checkout") || path.startsWith("/api/shop/checkout/"));
    }

    private static boolean isHost(String host, String domain) {
        return host.equals(domain) || host.endsWith("." + domain);
    }

    private static URI parse(String rawUrl) {
        if (rawUrl == null) return null;
        try {
            return new URI(rawUrl);
        } catch (URISyntaxException ignored) {
            return null;
        }
    }
}
