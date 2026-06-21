#!/usr/bin/env node
/**
 * Portfolio Sitemap Collector (v2)  —  Blockwall Insights
 * ----------------------------------------------------------------------------
 * Discovery method for the ~12 portfolio companies that have no feed but a usable
 * sitemap. Reads sitemap.xml (following an index), keeps REAL post URLs, and for
 * new ones pulls title/date/image/summary from og:/article:/JSON-LD/<time>/URL.
 *
 * v2 changes (from the seed-run findings):
 *   • Post filter now requires a real slug AFTER the section — bare section/index
 *     pages (/blog, /posts/, /fr/blog) and pagination/archives (/blog/page/2,
 *     /blog/2026) are no longer mistaken for posts.
 *   • Locale duplicates collapsed — /fr/blog/x and /de/blog/x fold to one entry
 *     (prefers the non-localized, then /en/, variant).
 *   • Date extraction widened (meta variants, <time datetime>, JSON-LD, and a
 *     YYYY/MM/DD in the URL) — but still returns null when genuinely undated, so
 *     the collector can sort undated items to the bottom rather than faking "today".
 *
 * Usage (integration):
 *   const sm = require('./portfolio-sitemap');
 *   const { items } = await sm.collectNewFromSitemap(
 *     { slug, sitemapUrl, domain }, seenUrlSet, { maxNew: 20 });
 *
 * Usage (verify a company live):
 *   node portfolio-sitemap.js --discover https://www.spiko.io/sitemap.xml
 *   node portfolio-sitemap.js --og https://www.spiko.io/blog/<some-post>
 *
 * Usage (offline logic test):  node portfolio-sitemap.js --selftest
 *
 * Node 18+ (built-in fetch). Zero dependencies. Read-only (GET requests only).
 */
'use strict';

const TIMEOUT_MS = 12000;
const UA = 'Mozilla/5.0 (compatible; BlockwallPortfolioCollector/1.0; +https://blockwall.vc)';
const SECTION_WORD = /^(blogs?|posts?|news|articles?|insights?|updates?|stories|story|press|resources?|learn|library)$/i;
const NONPOST_SLUG = /^(page|pages|tag|tags|category|categories|topic|topics|author|authors|archive|archives|feed|rss|amp|search|index|all)$/i;
const KNOWN_LOCALES = new Set(['en', 'fr', 'de', 'es', 'pt', 'it', 'nl', 'pl', 'ja', 'zh', 'ko', 'ru', 'tr', 'ar', 'sv', 'da', 'no', 'fi', 'cs', 'el', 'he', 'hi', 'id', 'th', 'vi', 'uk', 'ro', 'hu', 'sk', 'bg', 'hr', 'sr', 'sl', 'et', 'lv', 'lt', 'ca']);

// ── helpers ───────────────────────────────────────────────────────────────
function decode(s) {
    return String(s == null ? '' : s)
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
        .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
        .trim();
}
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }
function pathParts(url) { try { return new URL(url).pathname.split('/').filter(Boolean); } catch { return []; } }
function isLocale(seg) { const s = String(seg || '').toLowerCase(); return KNOWN_LOCALES.has(s) || /^[a-z]{2}-[a-z]{2,4}$/.test(s); }
function stripLocale(parts) { return parts.length && isLocale(parts[0]) ? parts.slice(1) : parts; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchText(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            redirect: 'follow', signal: ctrl.signal,
            headers: { 'user-agent': UA, 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        });
        const body = res.ok ? (await res.text()).slice(0, 2000000) : '';
        return { ok: res.ok, status: res.status, body, finalUrl: res.url || url };
    } catch (e) {
        return { ok: false, status: 0, body: '', error: e.name === 'AbortError' ? 'timeout' : e.message };
    } finally { clearTimeout(t); }
}

// ── post-URL recognition (the v2 fix) ────────────────────────────────────────
function isPostUrl(url) {
    let parts = stripLocale(pathParts(url));
    if (parts.length < 2) return false;                       // need section + slug
    if (/^\d+$/.test(parts[parts.length - 1])) return false;  // pagination / year archive
    for (let i = 0; i < parts.length - 1; i++) {
        if (SECTION_WORD.test(parts[i])) {
            if (NONPOST_SLUG.test(parts[i + 1])) return false;    // listing/archive: /blog/tag/x, /blog/page/2
            const rest = parts.slice(i + 1);
            if (rest.some(s => s.length >= 2 && !/^\d+$/.test(s) && !NONPOST_SLUG.test(s))) return true;
        }
    }
    return false;
}

// Collapse locale duplicates: same path minus the locale prefix -> keep one,
// preferring the non-localized variant, then /en/, then whatever came first.
function canonicalKey(url) {
    try {
        const u = new URL(url);
        return hostOf(url) + '/' + stripLocale(u.pathname.split('/').filter(Boolean)).join('/');
    } catch { return url; }
}
function localeScore(url) {
    const p = pathParts(url);
    if (!p.length || !isLocale(p[0])) return 2;          // no locale prefix — best
    return p[0].toLowerCase() === 'en' ? 1 : 0;
}
function dedupeLocales(entries) {
    const best = new Map();
    for (const e of entries) {
        const k = canonicalKey(e.url);
        const cur = best.get(k);
        if (!cur || localeScore(e.url) > localeScore(cur.url)) best.set(k, e);
    }
    return [...best.values()];
}

// Preferred-locale filter: keep non-prefixed and English URLs; DROP any URL whose
// first path segment is a non-English locale (the /fr//de//es/ translations). Unlike
// dedupeLocales (which only collapses same-slug locale variants), this also drops
// translations whose slug itself is localized (e.g. Spiko's /de/blog/<german-slug>,
// which has no shared canonical key with its English original). Applied during
// discovery — BEFORE the per-company cap — so the cap fills with distinct articles,
// not translations.
function isPreferredLocaleUrl(url) {
    const parts = pathParts(url);
    if (!parts.length) return true;
    const seg = String(parts[0]).toLowerCase();
    if (!isLocale(seg)) return true;            // not a locale prefix -> keep
    return seg === 'en' || /^en[-_]/.test(seg); // keep only English locale variants
}

// ── sitemap parsing ─────────────────────────────────────────────────────────
function parseSitemapXml(body) {
    const isIndex = /<sitemapindex[\s>]/i.test(body);
    const entries = [...body.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)].map(m => {
        const block = m[1];
        const loc = (block.match(/<loc>\s*([^<\s][^<]*?)\s*<\/loc>/i) || [])[1];
        const lastmod = (block.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i) || [])[1];
        return loc ? { url: decode(loc), lastmod: lastmod ? lastmod.trim() : null } : null;
    }).filter(Boolean);
    const children = isIndex
        ? [...body.matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi)]
            .map(m => (m[1].match(/<loc>\s*([^<\s][^<]*?)\s*<\/loc>/i) || [])[1]).filter(Boolean).map(decode)
        : [];
    return { isIndex, entries, children };
}

async function discoverPosts(sitemapUrl, { maxChildren = 6, childDelayMs = 250 } = {}) {
    const root = await fetchText(sitemapUrl);
    if (!root.ok) return { ok: false, error: `sitemap ${root.status || root.error}`, posts: [] };
    const parsed = parseSitemapXml(root.body);
    let entries = parsed.entries;

    if (parsed.isIndex && parsed.children.length) {
        const ordered = [
            ...parsed.children.filter(u => /(post|article|news|blog|insight|update|stor)/i.test(u)),
            ...parsed.children.filter(u => !/(post|article|news|blog|insight|update|stor)/i.test(u)),
        ].slice(0, maxChildren);
        entries = [];
        for (const child of ordered) {
            const r = await fetchText(child);
            if (r.ok) entries.push(...parseSitemapXml(r.body).entries);
            await sleep(childDelayMs);
        }
    }

    const posts = dedupeLocales(entries.filter(e => isPostUrl(e.url) && isPreferredLocaleUrl(e.url)));
    return { ok: true, total: entries.length, posts };
}

// ── og / meta / JSON-LD / <time> / URL date extraction ───────────────────────
function metaContent(html, keys) {
    const tags = html.match(/<meta\b[^>]*>/gi) || [];
    for (const key of keys) {
        const keyRe = new RegExp(`(?:property|name|itemprop)\\s*=\\s*["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i');
        for (const tag of tags) {
            if (keyRe.test(tag)) {
                const c = tag.match(/content\s*=\s*["']([^"']*)["']/i);
                if (c && c[1].trim()) return decode(c[1]);
            }
        }
    }
    return null;
}
function jsonLdDate(html) {
    const m = html.match(/"datePublished"\s*:\s*"([^"]+)"/i) || html.match(/"dateCreated"\s*:\s*"([^"]+)"/i);
    return m ? m[1].trim() : null;
}
function timeTagDate(html) {
    const m = html.match(/<time\b[^>]*\sdatetime\s*=\s*["']([^"']+)["']/i);
    return m ? m[1].trim() : null;
}
function dateFromUrl(url) {
    const m = String(url || '').match(/\/(20\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})(?=[\/\-?#]|$)/);
    return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}` : null;
}
function titleTag(html) {
    const m = html.match(/<title[^>]*>\s*([\s\S]*?)\s*<\/title>/i);
    return m ? decode(m[1].replace(/\s+/g, ' ')) : null;
}

function parseOg(html, url) {
    const published =
        metaContent(html, ['article:published_time', 'article:published', 'og:published_time',
            'article:modified_time', 'og:updated_time', 'datepublished', 'date', 'pubdate', 'publishdate',
            'publish-date', 'parsely-pub-date', 'sailthru.date', 'dc.date', 'dc.date.issued', 'dcterms.created', 'timestamp'])
        || jsonLdDate(html) || timeTagDate(html) || dateFromUrl(url);
    return {
        title: metaContent(html, ['og:title', 'twitter:title']) || titleTag(html),
        image: metaContent(html, ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src']),
        published: published || null,
        description: metaContent(html, ['og:description', 'description', 'twitter:description']),
        site_name: metaContent(html, ['og:site_name', 'application-name']),
    };
}

async function extractOg(url) {
    const r = await fetchText(url);
    if (!r.ok) return { ok: false, status: r.status, error: r.error };
    return { ok: true, ...parseOg(r.body, url) };
}

async function collectNewFromSitemap(company, seenUrls = new Set(), opts = {}) {
    const { maxNew = 20, enrichDelayMs = 350 } = opts;
    const disc = await discoverPosts(company.sitemapUrl, opts);
    if (!disc.ok) return { ok: false, error: disc.error, items: [] };

    const fresh = disc.posts.filter(p => !seenUrls.has(p.url)).slice(0, maxNew);
    const items = [];
    for (const p of fresh) {
        const og = await extractOg(p.url);
        items.push({
            company_slug: company.slug,
            url: p.url,
            title: (og.ok && og.title) || p.url,
            publisher: (og.ok && og.site_name) || hostOf(p.url),
            source_type: 'blog',
            date: (og.ok && og.published) || p.lastmod || null,   // honest null when undated
            image_url: (og.ok && og.image) || null,
            summary: (og.ok && og.description) || null,
        });
        await sleep(enrichDelayMs);
    }
    return { ok: true, discovered: disc.posts.length, new: items.length, items };
}

module.exports = {
    parseSitemapXml, discoverPosts, isPostUrl, dedupeLocales, isPreferredLocaleUrl, canonicalKey,
    metaContent, jsonLdDate, timeTagDate, dateFromUrl, parseOg, extractOg, collectNewFromSitemap,
};

// ── CLI + offline self-test ──────────────────────────────────────────────────
async function cli() {
    const argv = process.argv;
    if (argv.includes('--selftest')) return selftest();
    const dI = argv.indexOf('--discover');
    if (dI > -1 && argv[dI + 1]) {
        const r = await discoverPosts(argv[dI + 1]);
        if (!r.ok) { console.log('discover failed:', r.error); process.exit(1); }
        console.log(`discovered ${r.posts.length} post URLs (of ${r.total} entries):\n`);
        r.posts.slice(0, 30).forEach(p => console.log(`  ${p.lastmod || '         '}  ${p.url}`));
        return;
    }
    const oI = argv.indexOf('--og');
    if (oI > -1 && argv[oI + 1]) { console.log(JSON.stringify(await extractOg(argv[oI + 1]), null, 2)); return; }
    console.log('usage: --discover <sitemapUrl> | --og <postUrl> | --selftest');
}

function selftest() {
    let pass = 0, fail = 0;
    const A = (label, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); cond ? pass++ : fail++; };

    // sitemap parsing
    const urlset = `<urlset>
    <url><loc>https://x.io/blog/a-real-post</loc><lastmod>2026-06-01</lastmod></url>
    <url><loc>https://x.io/blog</loc></url>
    <url><loc>https://x.io/news/b-story</loc></url>
  </urlset>`;
    const p1 = parseSitemapXml(urlset);
    A('parse: 3 entries', p1.entries.length === 3);
    A('parse: lastmod', p1.entries[0].lastmod === '2026-06-01');
    const idx = `<sitemapindex><sitemap><loc>https://x.io/page-sitemap.xml</loc></sitemap><sitemap><loc>https://x.io/post-sitemap.xml</loc></sitemap></sitemapindex>`;
    A('parse: index + 2 children', parseSitemapXml(idx).isIndex && parseSitemapXml(idx).children.length === 2);

    // isPostUrl — the v2 fix
    A('post: section + slug accepted', isPostUrl('https://x.io/blog/my-post') === true);
    A('post: bare section rejected', isPostUrl('https://x.io/blog') === false);
    A('post: section trailing slash rejected', isPostUrl('https://x.io/posts/') === false);
    A('post: locale + bare section rejected', isPostUrl('https://x.io/fr/blog') === false);
    A('post: locale + section + slug accepted', isPostUrl('https://x.io/fr/blog/mon-article') === true);
    A('post: pagination rejected', isPostUrl('https://x.io/blog/page/2') === false);
    A('post: year archive rejected', isPostUrl('https://x.io/blog/2026') === false);
    A('post: dated path post accepted', isPostUrl('https://x.io/blog/2026/06/my-post') === true);
    A('post: non-blog page rejected', isPostUrl('https://x.io/about') === false);
    A('post: tag listing rejected', isPostUrl('https://x.io/blog/tag/defi') === false);

    // locale dedupe
    const deduped = dedupeLocales([
        { url: 'https://x.io/fr/blog/post', lastmod: null },
        { url: 'https://x.io/blog/post', lastmod: null },
        { url: 'https://x.io/de/blog/post', lastmod: null },
        { url: 'https://x.io/blog/other', lastmod: null },
    ]);
    A('dedupe: collapses locales to 2', deduped.length === 2);
    A('dedupe: keeps non-localized', deduped.some(e => e.url === 'https://x.io/blog/post'));

    // preferred-locale filter (drops translated-slug dupes that dedupeLocales misses)
    A('locale-pref: non-prefixed kept', isPreferredLocaleUrl('https://spiko.io/blog/a-day') === true);
    A('locale-pref: /en/ kept', isPreferredLocaleUrl('https://spiko.io/en/blog/a-day') === true);
    A('locale-pref: en-US kept', isPreferredLocaleUrl('https://spiko.io/en-us/blog/a-day') === true);
    A('locale-pref: /de/ dropped', isPreferredLocaleUrl('https://spiko.io/de/blog/ein-tag') === false);
    A('locale-pref: /fr/ dropped', isPreferredLocaleUrl('https://spiko.io/fr/blog/un-jour') === false);
    A('locale-pref: /es/ dropped', isPreferredLocaleUrl('https://spiko.io/es/blog/un-dia') === false);
    A('locale-pref: non-locale first seg kept (rss path)', isPreferredLocaleUrl('https://news.google.com/rss/articles/abc') === true);

    // dates
    A('dateFromUrl: /2026/06/12/', dateFromUrl('https://x.io/blog/2026/06/12/post') === '2026-06-12');
    A('timeTagDate', timeTagDate('<time datetime="2026-05-15T09:00:00Z">May 15</time>') === '2026-05-15T09:00:00Z');
    A('jsonLdDate', jsonLdDate('{"datePublished":"2026-05-15T09:00:00Z"}') === '2026-05-15T09:00:00Z');
    A('meta both orders', metaContent('<meta content="2026-06-01" property="article:published_time">', ['article:published_time']) === '2026-06-01');

    const page = `<html><head>
    <title>Fallback</title>
    <meta property="og:title" content="Spiko raises Series A">
    <meta property="og:image" content="https://x.io/img.png">
    <meta property="og:site_name" content="Spiko Blog">
  </head></html>`;
    const og = parseOg(page, 'https://x.io/blog/2026/06/12/spiko-series-a');
    A('parseOg: title', og.title === 'Spiko raises Series A');
    A('parseOg: image', og.image === 'https://x.io/img.png');
    A('parseOg: date from URL fallback', og.published === '2026-06-12');
    A('parseOg: truly undated -> null', parseOg('<html><head><title>x</title></head></html>', 'https://x.io/blog/no-date').published === null);

    console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'} (${pass}/${pass + fail})`);
    process.exit(fail === 0 ? 0 : 1);
}

if (require.main === module) cli().catch(e => { console.error('Fatal:', e); process.exit(1); });