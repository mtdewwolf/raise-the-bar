'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const gradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
const activity = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/raisethebar/game/MainActivity.java'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');

test('Android assets carry an unconditional platform marker and disallow embedded checkout', () => {
  const injection = gradle.indexOf('<meta name="rtb-platform" content="android">');
  assert.ok(injection >= 0 && injection < gradle.indexOf('if (rtbApi)'));
  assert.match(gradle, /frame-src 'none'; form-action 'none'/);
  assert.match(activity, /addJavascriptInterface\(new GameBridge\(\), "RTBAndroid"\)/);
  assert.match(activity, /public boolean supportsWebCheckout\(\)\s*\{\s*return false;/);
  assert.match(activity, /addWebMessageListener\(webView, "RTBPlayBilling"/);
  assert.match(activity, /Collections\.singleton\(GAME_ORIGIN\)/);
  assert.match(activity, /!isMainFrame \|\| !isGameOrigin\(sourceOrigin\)/);
  assert.doesNotMatch(activity, /@JavascriptInterface[\s\S]{0,120}(syncPlayAccount|beginPlayPurchase|restorePlayPurchases)/);
  assert.match(activity, /PaymentNavigationPolicy.blocksResource\(request.getUrl\(\).toString\(\), request.isForMainFrame\(\)\)/);
  assert.match(activity, /return !PaymentNavigationPolicy.isLocalGameUrl\(request.getUrl\(\).toString\(\)\)/);
  assert.match(activity, /setSupportMultipleWindows\(true\)/);
  assert.match(activity, /setJavaScriptCanOpenWindowsAutomatically\(false\)/);
  assert.doesNotMatch(activity, /startActivity\(new Intent\(Intent.ACTION_VIEW/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
});

test('Android release signing has no public test-key fallback', () => {
  const release = gradle.match(/\n        release \{([\s\S]*?)\n        \}/)?.[1];
  assert.ok(release);
  assert.match(release, /signingConfig signingConfigs.upload/);
  assert.doesNotMatch(release, /signingConfigs.test|\?:/);
  for (const setting of ['RTB_KEYSTORE_FILE', 'RTB_KEYSTORE_PASSWORD', 'RTB_KEY_ALIAS', 'RTB_KEY_PASSWORD']) {
    assert.ok(gradle.includes(setting));
  }
  assert.match(gradle, /task\.name == 'preDirectReleaseBuild' \|\| task\.name == 'prePlayStoreReleaseBuild'/);
  assert.match(gradle, /task\.name == 'prePlayStoreReleaseBuild'[\s\S]*?task\.dependsOn validatePlayStoreConfiguration/);
  assert.match(gradle, /6e7f72b668c448ff5e388d10894eb473098779bdc31fcee9acb51f944dc5f0cc/);
  assert.match(gradle, /internalTest \{[\s\S]*?versionNameSuffix '-internal-test'/);
  assert.match(gradle, /playStore \{[\s\S]*?applicationId 'com\.groves\.rtb'/);
  assert.match(gradle, /debug \{[\s\S]*?applicationIdSuffix '\.debug'/);
  assert.match(gradle, /internalTest \{[\s\S]*?applicationIdSuffix '\.internaltest'/);
  assert.match(gradle, /compileSdk 36/);
  assert.match(gradle, /targetSdk 36/);
  assert.match(gradle, /playStoreImplementation 'com\.android\.billingclient:billing:9\.1\.0'/);
});

test('Android native navigation policy blocks checkout and allows game API traffic', (t) => {
  const java = spawnSync('java', ['--list-modules'], { encoding: 'utf8' });
  if (java.error || java.status !== 0 || !java.stdout.includes('jdk.compiler@')) {
    t.skip('JDK unavailable; run sh android/test-payment-policy.sh on a JDK-equipped machine');
    return;
  }
  const classes = fs.mkdtempSync(path.join(os.tmpdir(), 'rtb-policy-'));
  try {
    const compile = spawnSync('java', ['-m', 'jdk.compiler/com.sun.tools.javac.Main', '-source', '17', '-target', '17', '-d', classes,
      path.join(root, 'android/app/src/main/java/com/raisethebar/game/PaymentNavigationPolicy.java'),
      path.join(root, 'android/tests/PaymentNavigationPolicyCheck.java')], { cwd: root, encoding: 'utf8' });
    assert.equal(compile.status, 0, compile.stdout + compile.stderr);
    const result = spawnSync('java', ['-cp', classes, 'com.raisethebar.game.PaymentNavigationPolicyCheck'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /49 checks passed/);
  } finally { fs.rmSync(classes, { recursive: true, force: true }); }
});
