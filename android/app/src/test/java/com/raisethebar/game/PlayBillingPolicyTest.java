package com.raisethebar.game;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PlayBillingPolicyTest {
    @Test
    public void backendMustBeFixedHttpsEndpoint() {
        assertTrue(PlayBillingPolicy.isSecureBackend("https://game.example/api"));
        assertFalse(PlayBillingPolicy.isSecureBackend(""));
        assertFalse(PlayBillingPolicy.isSecureBackend("http://game.example"));
        assertFalse(PlayBillingPolicy.isSecureBackend("https://user:pass@game.example"));
        assertFalse(PlayBillingPolicy.isSecureBackend("https://game.example?next=evil"));
        assertFalse(PlayBillingPolicy.isSecureBackend("https://game.example/#fragment"));
        assertFalse(PlayBillingPolicy.isSecureBackend("https://game.example:8443"));
    }

    @Test
    public void productIdHasNoImplicitFallback() {
        assertTrue(PlayBillingPolicy.isValidProductId("supporter_pack"));
        assertTrue(PlayBillingPolicy.isValidProductId("supporter.pack-v1"));
        assertFalse(PlayBillingPolicy.isValidProductId(""));
        assertFalse(PlayBillingPolicy.isValidProductId("Supporter Pack"));
        assertFalse(PlayBillingPolicy.isValidProductId("../supporter"));
    }

    @Test
    public void accountBindingIsStableAndAccountSpecific() {
        assertEquals(64, PlayBillingPolicy.accountBinding("alice").length());
        assertEquals(PlayBillingPolicy.accountBinding("alice"), PlayBillingPolicy.accountBinding("alice"));
        assertFalse(PlayBillingPolicy.accountBinding("alice").equals(PlayBillingPolicy.accountBinding("bob")));
        assertEquals("", PlayBillingPolicy.accountBinding(""));
    }
}
