'use strict';
// Execute client event handlers against the real local API with a minimal DOM stub.
// This is NOT visual/browser QA: layout, focus traversal, browser form validation,
// native WebView behavior and the real Stripe sandbox are deliberately unverified.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('../server');

const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(
  '  requestAnimationFrame(frame);\n})();',
  `  window.__test = {
    get profile() { return profile; }, get pending() { return pending; },
    get paidInventory() { return paidInventory; }, get accountBusy() { return accountBusy; },
    get panel() { return panel; }, get wallet() { return wallet; }, get look() { return look; },
    get owner() { return profileOwner(); }, get unlocked() { return unlocked; },
    openPanel, closePanel, renderAccount, accountAction, restorePurchases,
    adoptProfile, expireAccountSession, queueRun, ensureProfile, loadAccount,
    itemUnlocked, ITEMS, DEFAULT_LOOK, nativePurchasesUnavailable, testOfferReady
  };\n})();`
);
const PASSWORD = 'synthetic-test-password-123';
function storage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}
function boot(base, localStorage = storage(), sessionStorage = storage(), platform = '') {
  const ids = new Map(), requests = [];
  let document;
  function element(id = '') {
    return {
      id, hidden: false, disabled: false, value: '', checked: false, textContent: '',
      content: '', isConnected: true, children: [], style: { setProperty() {} },
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      getContext() { return {}; }, addEventListener() {},
      setAttribute(key, value) { this[key] = value; }, removeAttribute(key) { delete this[key]; },
      querySelector() { return element(); }, querySelectorAll() { return []; },
      getClientRects() { return [{}]; }, focus() { document.activeElement = this; },
      appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
    };
  }
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) ids.set(match[1], element(match[1]));
  document = {
    getElementById: id => ids.get(id), body: element(), documentElement: element(),
    activeElement: element(), hidden: false, addEventListener() {},
    querySelector: selector => selector.includes('rtb-api') ? { content: base }
      : platform === 'meta' && selector.includes('rtb-platform') ? { content: 'android' } : null,
    querySelectorAll: selector => selector === '.overlay'
      ? [...ids.values()].filter(el => ['menu', 'over', 'lb', 'locker', 'shop', 'ach', 'account', 'friends'].includes(el.id)) : [],
    createElement: element,
  };
  const context = {
    console, document, localStorage, sessionStorage, location: new URL(base),
    history: { replaceState() {} }, navigator: { userAgent: platform === 'ua' ? 'RaisingTheBarAndroid/1' : 'Test', maxTouchPoints: 0 },
    URL, URLSearchParams, AbortController, fetch: (url, options) => { requests.push(new URL(url).pathname); return fetch(url, options); },
    TextEncoder, TextDecoder, Buffer, atob, btoa, performance, Date,
    setTimeout: () => 1, clearTimeout() {}, setInterval() {}, requestAnimationFrame() {},
    getComputedStyle: () => ({}), innerWidth: 390, innerHeight: 844,
    devicePixelRatio: 1, addEventListener() {}, matchMedia: () => ({ matches: false }),
  };
  context.window = context;
  if (platform === 'bridge') context.Android = {};
  if (platform === 'rtb-bridge') context.RTBAndroid = {};
  context.location.assign = () => { throw new Error('Unexpected checkout navigation'); };
  vm.createContext(context);
  vm.runInContext(script, context);
  assert(context.__test, 'Test seam must be present without changing application source');
  return { context, state: context.__test, ids, localStorage, sessionStorage, requests };
}
async function waitFor(predicate) {
  for (let count = 0; count < 500; count++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('UI state did not settle');
}
const submit = element => element.onsubmit({ preventDefault() {} });

test('account client state: recovery, session secrets, interruption guards, owner isolation and native checkout', { timeout: 15000 }, async () => {
  const app = createApp({ dbFile: ':memory:' });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.address().port;
  try {
    const client = boot(base), state = client.state, get = id => client.ids.get(id);
    await state.openPanel('account');
    assert.equal(get('testCheckout').disabled, true);
    assert.match(get('accountStatus').textContent, /Accounts protect/);
    get('registerUsername').value = 'uitest_player';
    get('registerPassword').value = PASSWORD;
    submit(get('accountRegisterForm'));
    assert.match(get('accountStatus').textContent, /Confirm which existing profile/);
    assert(!client.requests.includes('/api/account/register'), 'Migration requires explicit consent');
    get('accountConfirmLink').checked = true;
    submit(get('accountRegisterForm'));
    await waitFor(() => !state.accountBusy);
    assert.match(get('accountStatus').textContent, /Account created/);
    const recoveryCode = get('accountRecoveryCode').textContent;
    assert(recoveryCode.length > 15);
    assert.equal(state.profile.account.username, 'uitest_player');
    assert(!JSON.parse(client.localStorage.getItem('rtb_profile')).token);
    assert(JSON.parse(client.sessionStorage.getItem('rtb_account_session')).token);
    assert.equal(get('registerPassword').value, '');
    assert.equal(get('legacySync').hidden, true);
    assert.equal(get('testCheckout').disabled, true);

    get('confirmRecoveryCode').value = 'wrong-code';
    submit(get('accountConfirmRecoveryForm'));
    await waitFor(() => !state.accountBusy);
    assert(state.profile.token, 'A wrong recovery code must not clear a valid bearer');
    get('confirmRecoveryCode').value = recoveryCode;
    submit(get('accountConfirmRecoveryForm'));
    await waitFor(() => !state.accountBusy);
    assert.equal(state.profile.account.recoveryConfirmed, true);
    assert.equal(get('accountRecoveryCode').textContent, '');
    assert(get('testCheckout').disabled, 'Disabled shop stays closed after recovery confirmation');
    get('accountRestore').onclick();
    await waitFor(() => !state.accountBusy);
    assert.match(get('accountStatus').textContent, /Purchases checked/);
    assert(!state.paidInventory.has('band:supporter'));
    assert.equal(state.itemUnlocked(state.ITEMS.find(item => item.id === 'supporter')), false);

    const offer = { mode: 'test', checkoutEnabled: true, items: [{ sku: 'supporter_pack', amount: 499, currency: 'usd' }] };
    assert(state.testOfferReady(offer));
    assert(!state.testOfferReady({ ...offer, mode: 'live' }));
    assert(!state.testOfferReady({ ...offer, checkoutEnabled: false }));
    assert(!state.testOfferReady({ ...offer, items: [{ sku: 'supporter_pack', amount: 999, currency: 'usd' }] }));

    get('rotatePassword').value = PASSWORD;
    submit(get('accountRotateForm'));
    state.closePanel();
    assert.equal(state.panel, 'account', 'Close cannot orphan an account request');
    state.openPanel('locker');
    assert.equal(state.panel, 'account', 'Panel change cannot permit late checkout navigation');
    await waitFor(() => !state.accountBusy);
    assert.match(get('accountStatus').textContent, /Recovery code replaced/);
    const replacementCode = get('accountRecoveryCode').textContent;
    assert.notEqual(replacementCode, recoveryCode);
    state.closePanel();
    assert.equal(get('accountRecoveryCode').textContent, '');
    assert.equal(state.panel, null);
    await state.openPanel('account');
    const accountOwner = state.owner;
    state.queueRun('synthetic-owner-marker');

    get('accountLogout').onclick();
    await waitFor(() => !state.accountBusy);
    assert.equal(state.profile, null);
    assert.equal(client.sessionStorage.getItem('rtb_account_session'), null);
    assert.equal(state.wallet.earned, 0, 'The next guest cannot inherit signed-out progress');
    await state.ensureProfile();
    assert.notEqual(state.owner, accountOwner);
    assert.equal(state.pending.find(entry => entry.replay === 'synthetic-owner-marker').owner, accountOwner);
    get('recoverUsername').value = 'uitest_player';
    get('recoverCode').value = replacementCode;
    get('recoverPassword').value = PASSWORD + '-reset';
    submit(get('accountRecoverForm'));
    await waitFor(() => !state.accountBusy);
    assert.match(get('accountStatus').textContent, /Password reset/);
    assert.equal(state.owner, accountOwner);
    assert.equal(get('recoverPassword').value, '');
    assert.equal(get('recoverCode').value, '');
    assert.notEqual(get('accountRecoveryCode').textContent, replacementCode);

    const reload = boot(base, client.localStorage, client.sessionStorage);
    await reload.state.openPanel('account');
    assert(reload.state.profile.token);
    assert(reload.ids.get('legacySync').hidden);
    const newTab = boot(base, client.localStorage);
    await newTab.state.openPanel('account');
    assert(newTab.state.profile.account);
    assert(!newTab.state.profile.token);
    await assert.rejects(() => newTab.state.ensureProfile(), /Sign in/);
    assert.equal(newTab.state.profile.playerId, state.profile.playerId);
    get('accountLogout').onclick();
    await waitFor(() => !state.accountBusy);
    get('loginUsername').value = 'uitest_player';
    get('loginPassword').value = PASSWORD + '-reset';
    submit(get('accountLoginForm'));
    await waitFor(() => !state.accountBusy);
    assert.match(get('accountStatus').textContent, /Signed in/);

    for (const marker of ['ua', 'meta', 'bridge', 'rtb-bridge']) {
      const native = boot(base, storage(), storage(), marker);
      await native.state.openPanel('account');
      assert(native.ids.get('testCheckout').hidden, marker);
      assert(native.ids.get('testCheckout').disabled, marker);
      assert.match(native.ids.get('testShopStatus').textContent, /unavailable in the Android app/);
      native.ids.get('testCheckout').onclick();
      await waitFor(() => !native.state.accountBusy);
      assert(!native.requests.includes('/api/shop/checkout'), 'Native guard applies to action as well as rendering');
    }
    state.expireAccountSession();
    assert(!state.profile.token);
    assert.equal(client.sessionStorage.getItem('rtb_account_session'), null);
  } finally {
    await app.closeAll();
  }
});
