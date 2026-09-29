'use strict';
const qrcode = require('./vendor/qrcode');
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function inviteUrl(req, code, { publicUrl, trustProxy } = {}) {
  const protocol = trustProxy && req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const base = publicUrl || `${protocol}://${req.headers.host}`;
  const url = new URL('/challenge/' + code, base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Challenge links need an HTTP(S) public URL');
  return url.href;
}
function qrSvg(url) {
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  return qr.createSvgTag({ cellSize: 5, margin: 20, scalable: true, alt: 'Scan to join this challenge' });
}
function invitePage(html, challenge, url) {
  const host = challenge.entries.find(e => e.creator);
  const title = `${host ? host.name : 'A friend'} challenged you — Raising the Bar`;
  const leader = challenge.entries.find(e => e.height !== null);
  const description = `${challenge.title}. ${leader ? 'Beat ' + leader.height.toFixed(2) + 'm. ' : ''}Tap to join and play. Same ladder, no upgrades.`;
  return html.replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i, '').replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtml(url)}">
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(url)}">`);
}
module.exports = { inviteUrl, qrSvg, invitePage };
