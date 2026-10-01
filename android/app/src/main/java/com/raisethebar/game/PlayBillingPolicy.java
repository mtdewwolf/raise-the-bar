package com.raisethebar.game;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** Security-critical validation shared by the Play Billing client and local tests. */
final class PlayBillingPolicy {
    static final String SKU = "supporter_pack";
    static final String ENTITLEMENT = "band:supporter";

    private PlayBillingPolicy() {}

    static boolean isSecureBackend(String raw) {
        if (raw == null || raw.isBlank()) return false;
        try {
            URI uri = new URI(raw);
            return "https".equalsIgnoreCase(uri.getScheme())
                    && uri.getHost() != null
                    && uri.getRawUserInfo() == null
                    && uri.getPort() == -1
                    && uri.getRawQuery() == null
                    && uri.getRawFragment() == null;
        } catch (URISyntaxException ignored) {
            return false;
        }
    }

    static boolean isValidProductId(String productId) {
        return productId != null && productId.matches("[a-z0-9][a-z0-9._-]{0,149}");
    }

    /** Stable, non-reversible Play account binding; the backend computes the same value. */
    static String accountBinding(String canonicalUsername) {
        if (canonicalUsername == null || canonicalUsername.isBlank()) return "";
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(("rtb-play:" + canonicalUsername).getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder(digest.length * 2);
            for (byte b : digest) out.append(String.format("%02x", b & 0xff));
            return out.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new AssertionError(impossible);
        }
    }
}
