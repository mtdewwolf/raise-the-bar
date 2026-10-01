/* Native Google Play Billing UI adapter. The WebView never handles purchase tokens or grants. */
(function () {
  'use strict';
  // Android creates this object only for the Play flavor and only for this bundled,
  // exact-origin main frame. No wildcard origin or payment JavascriptInterface is used.
  const channel = window.RTBPlayBilling;
  if (!channel || typeof channel.postMessage !== 'function') return;

  let billing = { state: 'connecting', message: 'Connecting to Google Play.', formattedPrice: '' };

  function session() {
    try {
      const value = JSON.parse(sessionStorage.getItem('rtb_account_session') || 'null');
      if (!value || !value.token || !value.account || !value.account.username) return null;
      return {
        token: value.token,
        username: value.account.username,
        recoveryConfirmed: value.account.recoveryConfirmed === true
      };
    } catch (_) {
      return null;
    }
  }

  function post(action, current) {
    channel.postMessage(JSON.stringify({ action: action, account: current || {} }));
  }

  function syncAccount() {
    const current = session();
    post('sync', current);
    return current;
  }

  function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function render() {
    const buy = document.getElementById('testCheckout');
    const restore = document.getElementById('accountRestore');
    const status = document.getElementById('testShopStatus');
    const price = document.getElementById('testShopPrice');
    if (!buy || !restore || !status || !price) return;

    const current = session();
    const owned = !document.getElementById('supporterWear').hidden;
    if (buy.hidden) buy.hidden = false;
    setText(buy, 'Buy with Google Play');
    const buyDisabled = owned || !current || !current.recoveryConfirmed || billing.state !== 'ready';
    if (buy.disabled !== buyDisabled) buy.disabled = buyDisabled;
    const restoreDisabled = !current || billing.state === 'verifying';
    if (restore.disabled !== restoreDisabled) restore.disabled = restoreDisabled;

    if (billing.formattedPrice) {
      setText(price, billing.formattedPrice + ' via Google Play, one time. Permanent cosmetic; no gameplay advantage.');
    } else {
      setText(price, 'Google Play price unavailable. This permanent cosmetic cannot be purchased yet.');
    }

    if (owned) setText(status, 'Owned on this account. Your Supporter headband is ready in the Locker.');
    else if (!current) setText(status, 'Sign in before buying or restoring this permanent cosmetic.');
    else if (!current.recoveryConfirmed) setText(status, 'Save and confirm your recovery code before buying.');
    else setText(status, billing.message);
  }

  window.rtbPlayBillingUpdate = function (update) {
    if (!update || typeof update.state !== 'string' || typeof update.message !== 'string') return;
    billing = {
      state: update.state,
      message: update.message,
      formattedPrice: typeof update.formattedPrice === 'string' ? update.formattedPrice : billing.formattedPrice
    };
    render();
  };

  window.rtbPlayBillingEntitlementsChanged = function () {
    const refresh = document.getElementById('accountRefresh');
    if (refresh && !refresh.disabled) refresh.click();
    render();
  };

  document.addEventListener('click', function (event) {
    const button = event.target && event.target.closest && event.target.closest('button');
    if (!button) return;
    if (button.id === 'testCheckout') {
      event.preventDefault(); event.stopImmediatePropagation();
      const current = syncAccount();
      if (!current || !current.recoveryConfirmed || billing.state !== 'ready') return;
      billing.state = 'launching'; billing.message = 'Opening Google Play.'; render();
      post('purchase', current);
    } else if (button.id === 'accountRestore') {
      event.preventDefault(); event.stopImmediatePropagation();
      const current = syncAccount();
      if (!current) return;
      billing.state = 'verifying'; billing.message = 'Checking Google Play purchases with the server.'; render();
      post('restore', current);
    }
  }, true);

  // Account rendering rewrites the Android purchase controls. Re-apply only differing values.
  new MutationObserver(render).observe(document.getElementById('account'), {
    attributes: true, childList: true, subtree: true
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { syncAccount(); render(); }
  });
  window.addEventListener('focus', function () { syncAccount(); render(); });
  syncAccount();
  render();
})();
