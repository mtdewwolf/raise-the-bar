'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const { inviteUrl, invitePage } = require('../invites');

test('public invite opens the game with preview metadata and a locally generated QR', async () => {
  const app = createApp({dbFile: ':memory:', publicUrl: 'https://friends.example.com'});
  await new Promise(r => app.listen(0, r));
  const base = 'http://127.0.0.1:' + app.address().port;
  const post = async (path, body, token) => {
    const r = await fetch(base + path, {method:'POST', headers:{'content-type':'application/json', ...(token ? {authorization:'Bearer ' + token} : {})}, body:JSON.stringify(body)});
    return r.json();
  };
  try {
    const p = await post('/api/player', {name:'Invite Host'});
    const c = await post('/api/challenges', {}, p.token);
    const invite = await fetch(base + '/challenge/' + c.code);
    assert.equal(invite.status, 200);
    const html = await invite.text();
    assert.match(html, /Invite Host challenged you/);
    assert.match(html, /og:description/); assert.ok(html.includes('https://friends.example.com/challenge/' + c.code));
    assert.match(html, /id="friendCreate"/); assert.doesNotMatch(html, /id="friendJoinCode"|id="friendDemo"/);
    assert.ok(!html.includes(p.token));
    const qr = await fetch(base + '/challenge/' + c.code + '/qr.svg');
    assert.equal(qr.status, 200); assert.equal(qr.headers.get('content-type'), 'image/svg+xml');
    assert.match(await qr.text(), /<svg/);
    assert.equal((await fetch(base + '/challenge/FFFFFFFFFFFF')).status, 404);
    assert.equal((await fetch(base + '/challenge/FFFFFFFFFFFF/qr.svg')).status, 404);
    // Merely following/scanning a link must not join the visitor or change the host's score.
    const detail = await (await fetch(base + '/api/challenges/' + c.code)).json();
    assert.equal(detail.entries.length, 1); assert.equal(detail.entries[0].height, null);
  } finally { await app.closeAll(); }
});

test('invite URL uses configured public origin and preview text is escaped', () => {
  const code = 'ABCDEF123456';
  const req = {headers:{host:'localhost:9000', 'x-forwarded-proto':'https'}};
  assert.equal(inviteUrl(req, code), 'http://localhost:9000/challenge/' + code);
  assert.equal(inviteUrl(req, code, {trustProxy:true}), 'https://localhost:9000/challenge/' + code);
  assert.equal(inviteUrl(req, code, {publicUrl:'https://game.example/'}), 'https://game.example/challenge/' + code);
  const page = invitePage('<title>Raising the Bar</title>', {title:'<script>',entries:[{creator:true,name:'"<img>',height:null}]}, 'https://game.example/?x="');
  assert.ok(!page.includes('<img>')); assert.ok(!page.includes('<script>')); assert.match(page, /&quot;&lt;img&gt;/);
  const themed = invitePage('<meta name="description" content="Game description"><title>Raising the Bar · Night Arena</title>', {title:'Friends Ladder', entries:[{creator:true,name:'Host',height:null}]}, 'https://game.example/');
  assert.match(themed, /<title>Host challenged you/);
  assert.equal((themed.match(/name="description"/g) || []).length, 1);
});
