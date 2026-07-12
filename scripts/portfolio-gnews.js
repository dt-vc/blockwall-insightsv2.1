#!/usr/bin/env node
/**
 * Google News RSS URL decoder  —  Blockwall Insights  (FIX B)
 * ----------------------------------------------------------------------------
 * Google News RSS <link>s are now opaque redirect URLs:
 *   https://news.google.com/rss/articles/CBMi<blob>...?oc=5
 * The collector's validator matches on the real publisher domain/text, which the
 * opaque URL defeats — so ~100% of real coverage was dropped. This resolves a
 * CBMi link to the real publisher URL so the item can be enriched + validated.
 *
 * Method (verified live 2026-07-12, resolved 4/4 test articles):
 *   (a) OFFLINE: base64url-decode the article id as protobuf; if field 4 is itself
 *       an http(s) URL, return it. For CURRENT articles that field is an internal
 *       "AU_yqL…" token (NOT a URL) → offline returns null → fall through.
 *   (b) NETWORK: GET the /rss/articles/<id> page (with CONSENT cookies to skip the
 *       consent 302), scrape data-n-a-sg (signature) + data-n-a-ts (timestamp) +
 *       data-n-a-id, POST them to the batchexecute Fbv4je RPC (garturlreq), and
 *       read the resolved URL out of the garturlres response.
 *
 * The signature/timestamp are a matched, EXPIRING pair — scrape and POST in the
 * same call; never cache them. The resolved publisher URL IS stable and the caller
 * should dedup on it. Undocumented Google internals — pin a monitoring test.
 *
 * Node 18+ (built-in fetch/AbortController). Zero dependencies. Read-only.
 *
 * Usage:   const { decodeGoogleNewsUrl } = require('./portfolio-gnews');
 *          const real = await decodeGoogleNewsUrl(item.link);   // string | null
 * CLI:     node portfolio-gnews.js <googleNewsUrl>
 *          node portfolio-gnews.js --test        (live end-to-end against a search)
 */
'use strict';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function offlineDecode(id) {
  try {
    let b64 = id.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const b = Buffer.from(b64, 'base64');
    if (b[0] !== 0x08 || b[1] !== 0x13) {            // very old links: raw base64 of the URL
      const s = b.toString('utf8').match(/https?:\/\/[^\s"'<>\\]+/);
      return s ? s[0] : null;
    }
    if (b[2] !== 0x22) return null;                  // protobuf field 4 (length-delimited)
    let i = 3, len = 0, sh = 0, byte;
    do { byte = b[i++]; len |= (byte & 0x7f) << sh; sh += 7; } while (byte & 0x80);
    const str = b.slice(i, i + len).toString('utf8');
    return /^https?:\/\//.test(str) ? str : null;    // "AU_yqL…" token → null → use network
  } catch { return null; }
}

async function decodeGoogleNewsUrl(url, { timeoutMs = 12000 } = {}) {
  if (!url || typeof url !== 'string') return null;
  if (!/news\.google\.[^/]+\/(?:rss\/)?articles\//.test(url)) {
    return /^https?:\/\//.test(url) ? url : null;    // already a real URL → pass through
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const m = url.match(/\/(?:rss\/)?articles\/([^?/]+)/);
    if (!m) return null;
    const id = m[1];

    const off = offlineDecode(id);
    if (off) return off;

    // scrape signature/timestamp from the article page
    const page = await fetch(`https://news.google.com/rss/articles/${id}`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Cookie': 'CONSENT=YES+cb; SOCS=CAI' },
    });
    if (!page.ok) return null;
    const html = await page.text();
    const sg = html.match(/data-n-a-sg="([^"]+)"/);
    const ts = html.match(/data-n-a-ts="([^"]+)"/);
    const nid = html.match(/data-n-a-id="([^"]+)"/);
    if (!sg || !ts) return null;                     // markup changed / consent-captcha

    const inner = ['garturlreq',
      [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1],
        'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
      nid ? nid[1] : id, Number(ts[1]), sg[1]];
    const body = 'f.req=' + encodeURIComponent(
      JSON.stringify([[['Fbv4je', JSON.stringify(inner), null, 'generic']]]));

    const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA },
      body,
    });
    if (!res.ok) return null;
    const txt = await res.text();                    // )]}'\n\n[["wrb.fr","Fbv4je","[...]",...]]
    const line = txt.split('\n').find(l => l.includes('garturlres'));
    if (!line) return null;
    for (const part of JSON.parse(line)) {
      if (Array.isArray(part) && part[1] === 'Fbv4je' && typeof part[2] === 'string') {
        const dec = JSON.parse(part[2]);             // ["garturlres","<URL>",1]
        if (typeof dec?.[1] === 'string' && /^https?:\/\//.test(dec[1])) return dec[1];
      }
    }
    return null;
  } catch { return null; }                           // timeout/abort/network → null
  finally { clearTimeout(t); }
}

module.exports = { decodeGoogleNewsUrl, offlineDecode };

// ── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    const arg = process.argv[2];
    if (arg === '--test') {
      const xml = await fetch('https://news.google.com/rss/search?q=coindesk&hl=en-US&gl=US&ceid=US:en',
        { headers: { 'User-Agent': UA } }).then(r => r.text());
      const link = (xml.match(/<link>(https:\/\/news\.google\.com\/rss\/articles\/[^<]+)<\/link>/) || [])[1];
      console.log('IN :', link);
      console.log('OUT:', await decodeGoogleNewsUrl(link));
      return;
    }
    if (!arg) { console.log('usage: node portfolio-gnews.js <googleNewsUrl> | --test'); return; }
    console.log(await decodeGoogleNewsUrl(arg));
  })().catch(e => { console.error('Fatal:', e); process.exit(1); });
}
