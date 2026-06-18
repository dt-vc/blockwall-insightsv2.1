#!/usr/bin/env node
/**
 * backfill-edition-images.js
 *
 * One-off, idempotent image backfill for already-published Blockwall edition JSON.
 * Fills ONLY missing image_url fields (never overwrites an existing one) by:
 *   1) optional DB lookup of bw_articles_raw.image_url (feed image captured at ingest), then
 *   2) scraping the article's og:image (twitter:image fallback) — the same source Assemble uses.
 * Then re-derives the manifest thumbnail for editions whose thumbnail is currently null (#5).
 *
 * It does NOT touch content, prose, ordering, sentiment, generated_at, or engine — images only.
 * It only fills a manifest thumbnail when the existing one is null (never churns existing cards).
 *
 * REQUIREMENTS: Node 18+ (uses global fetch). Run from the repo root.
 * OPTIONAL DB:  set DATABASE_URL (Neon connection string) and `npm i pg` to also recover images
 *               scraping can't — e.g. The Block, whose feed images were captured at ingest/backfill.
 *
 * USAGE:
 *   1) Preview (writes nothing):                     node backfill-edition-images.js
 *   2) Apply: set DRY_RUN = false below, then:        node backfill-edition-images.js
 *      (also recover The Block etc.):  DATABASE_URL="postgres://...neon..." node backfill-edition-images.js
 *   3) Review `git diff data/`, then commit + push.
 *
 * Safe to re-run: only nulls get filled. Re-running with DATABASE_URL after a scrape-only pass
 * fills the remaining Block items from the captured feed images.
 */

'use strict';
const fs = require('fs');
const path = require('path');

// ----------------------------- CONFIG -----------------------------
const REPO_ROOT = process.env.REPO_ROOT || '.';   // run from repo root, or set REPO_ROOT
let DRY_RUN = false;                            // <<< set to false to actually write files
const CONCURRENCY = 8;                              // parallel scrape requests
const TIMEOUT_MS = 12000;                          // per-request timeout

// Hosts that hard-block bot scraping -> leave null (renders as the branded tile).
// (The Block is Cloudflare-protected; its feed images are recoverable only via the DB path.)
const BLOCKLIST = ['theblock.co', 'bloomberg.com'];

// Sections that carry images. Remove 'all_resources' for a fast, signals-only pass.
const SECTIONS = ['top_signals', 'on_the_radar', 'worth_a_read', 'all_resources'];

// Edition files to patch: the zero-image June band + W24/W25, and the null-thumbnail monthlies (#5).
const EDITIONS = [
    'data/daily/2026-06-11.json',
    'data/daily/2026-06-12.json',
    'data/daily/2026-06-13.json',
    'data/daily/2026-06-14.json',
    'data/daily/2026-06-15.json',
    'data/daily/2026-06-16.json',
    'data/weekly/2026-W24.json',
    'data/weekly/2026-W25.json',
    // Monthly thumbnails (#5): fills the signals so a thumbnail can be derived.
    // Comment these out for a faster run if you only care about daily/weekly.
    'data/monthly/2026-02.json',
    'data/monthly/2026-04.json',
    'data/monthly/2026-05.json',
];
// -------------------------------------------------------------------

if (typeof fetch !== 'function') {
    console.error('This script needs Node 18+ (global fetch is missing in your Node).');
    process.exit(1);
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const rawIdOf = (id) => { const m = String(id || '').match(/(\d+)/); return m ? m[1] : null; };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const isBlocked = (u) => { const h = hostOf(u); return BLOCKLIST.some(b => h === b || h.endsWith('.' + b)); };

function decodeEntities(s) {
    return String(s)
        .replace(/&amp;/g, '&').replace(/&#0*38;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&#x27;/gi, "'");
}

function extractOgImage(html, baseUrl) {
    if (!html) return null;
    const head = html.slice(0, 200000); // og/twitter meta tags live in <head>
    const patterns = [
        /<meta[^>]+(?:property|name)=["']og:image(?::secure_url|:url)?["'][^>]*\scontent=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image(?::secure_url|:url)?["']/i,
        /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]*\scontent=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
    ];
    for (const re of patterns) {
        const m = head.match(re);
        if (m && m[1]) {
            let url = decodeEntities(m[1].trim());
            try { url = new URL(url, baseUrl).href; } catch { /* keep as-is */ }
            if (/^https?:\/\//i.test(url)) return url;
        }
    }
    return null;
}

async function fetchOgImage(url) {
    if (!url || isBlocked(url)) return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            redirect: 'follow',
            signal: ctrl.signal,
            headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
        });
        if (!res.ok) return null;
        const ct = res.headers.get('content-type') || '';
        if (!/text\/html|application\/xhtml/i.test(ct)) return null;
        return extractOgImage(await res.text(), url);
    } catch {
        return null;
    } finally {
        clearTimeout(t);
    }
}

async function mapLimit(items, limit, fn) {
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
        while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
    });
    await Promise.all(workers);
}

function itemsOf(edition) {
    const out = [];
    for (const sec of SECTIONS) {
        if (sec === 'all_resources') {
            for (const g of (edition.all_resources || [])) for (const it of (g.items || [])) out.push(it);
        } else {
            for (const it of (edition[sec] || [])) out.push(it);
        }
    }
    return out;
}

// Hero/thumbnail = first imaged signal (top_signals first, then radar, then worth_a_read).
function firstImagedThumb(edition) {
    for (const sec of ['top_signals', 'on_the_radar', 'worth_a_read'])
        for (const it of (edition[sec] || [])) if (it.image_url) return it.image_url;
    return null;
}

(async () => {
    // 1) Load editions (bare edition objects)
    const loaded = [];
    for (const rel of EDITIONS) {
        const p = path.join(REPO_ROOT, rel);
        if (!fs.existsSync(p)) { console.warn(`SKIP (not found): ${rel}`); continue; }
        let ed;
        try { ed = JSON.parse(fs.readFileSync(p, 'utf8')); }
        catch (e) { console.warn(`SKIP (parse error): ${rel} - ${e.message}`); continue; }
        if (!ed || !ed.type || !ed.id) { console.warn(`SKIP (not a bare edition): ${rel}`); continue; }
        loaded.push({ rel, p, cadence: ed.type, edition: ed });
    }
    if (!loaded.length) { console.error('No editions loaded. Run from repo root or set REPO_ROOT.'); process.exit(1); }

    // 2) Gather items missing an image
    const needItems = [];
    for (const { edition } of loaded)
        for (const it of itemsOf(edition))
            if (!it.image_url && it.url) needItems.push(it);
    console.log(`Editions: ${loaded.length} | items missing image: ${needItems.length}`);

    // 3) Optional DB lookup (feed images captured at ingest -> recovers The Block etc.)
    const dbMap = new Map();
    if (process.env.DATABASE_URL) {
        try {
            const { Pool } = require('pg');
            const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
            const ids = [...new Set(needItems.map(it => rawIdOf(it.id)).filter(Boolean).map(Number))];
            if (ids.length) {
                const { rows } = await pool.query(
                    'SELECT id, image_url FROM bw_articles_raw WHERE id = ANY($1) AND image_url IS NOT NULL', [ids]);
                for (const r of rows) dbMap.set(String(r.id), r.image_url);
            }
            await pool.end();
            console.log(`DB: matched ${dbMap.size} image_url(s) from bw_articles_raw`);
        } catch (e) {
            console.warn(`DB lookup skipped (${e.message}). Continuing scrape-only.`);
        }
    } else {
        console.log('DB: DATABASE_URL not set -> scrape-only (set it + `npm i pg` to also recover The Block).');
    }

    // 4) Scrape unique URLs not already covered by DB and not blocklisted
    const toScrape = [...new Set(
        needItems.filter(it => !dbMap.get(rawIdOf(it.id))).map(it => it.url).filter(u => u && !isBlocked(u))
    )];
    console.log(`Scraping ${toScrape.length} unique URL(s) (concurrency ${CONCURRENCY}) ...`);
    const scrapeMap = new Map();
    let done = 0;
    await mapLimit(toScrape, CONCURRENCY, async (u) => {
        const img = await fetchOgImage(u);
        if (img) scrapeMap.set(u, img);
        if (++done % 25 === 0) console.log(`  ...${done}/${toScrape.length}`);
    });
    console.log(`Scrape hits: ${scrapeMap.size}/${toScrape.length}`);

    // 5) Apply fills + derive thumbnails
    const manifestUpdates = {}; // cadence -> { id -> thumb }
    let totalFilled = 0;
    for (const { rel, cadence, edition } of loaded) {
        let filled = 0, missing = 0;
        for (const it of itemsOf(edition)) {
            if (it.image_url || !it.url) continue;
            const img = dbMap.get(rawIdOf(it.id)) || scrapeMap.get(it.url) || null;
            if (img) { it.image_url = img; filled++; totalFilled++; } else missing++;
        }
        const thumb = firstImagedThumb(edition);
        (manifestUpdates[cadence] ||= {})[edition.id] = thumb;
        console.log(`  ${rel}: filled ${filled}, still-missing ${missing}, thumb=${thumb ? 'derived' : 'none'}`);
    }
    console.log(`TOTAL filled: ${totalFilled}`);

    // 6) Write
    if (DRY_RUN) {
        console.log('\nDRY RUN - nothing written. Set DRY_RUN = false at the top, then re-run to apply.');
        return;
    }
    for (const { p, edition } of loaded) fs.writeFileSync(p, JSON.stringify(edition, null, 2) + '\n');
    for (const [cadence, updates] of Object.entries(manifestUpdates)) {
        const mp = path.join(REPO_ROOT, 'data', `${cadence}.json`);
        if (!fs.existsSync(mp)) { console.warn(`manifest not found: data/${cadence}.json`); continue; }
        const man = JSON.parse(fs.readFileSync(mp, 'utf8'));
        let changed = 0;
        for (const entry of man) {
            // Only fill a NULL thumbnail; never churn an existing card image.
            if (entry && (entry.id in updates) && updates[entry.id] && !entry.thumbnail) {
                entry.thumbnail = updates[entry.id]; changed++;
            }
        }
        fs.writeFileSync(mp, JSON.stringify(man, null, 2) + '\n');
        console.log(`manifest data/${cadence}.json: filled ${changed} null thumbnail(s)`);
    }
    console.log('\nDone. Review `git diff data/` and commit.');
})();