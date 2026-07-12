#!/usr/bin/env node
/**
 * Portfolio Update Collector
 *
 * Fetches news/blog/X posts for all portfolio companies and generates
 * all derived index files. No npm dependencies — uses Node 18+ built-in fetch.
 *
 * Usage:
 *   node collect-portfolio-updates.js              # normal run
 *   node collect-portfolio-updates.js --backfill   # include older results
 *
 * Environment variables (optional):
 *   TWITTER_BEARER_TOKEN  — X API v2 bearer token for fetching tweets
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildValidators } = require('./portfolio-validate');
const sitemap = require('./portfolio-sitemap');
const gnews = require('./portfolio-gnews');

// ── paths ───────────────────────────────────────────────────────────────────
const ROOT       = path.join(__dirname, '..');
const DATA_DIR   = path.join(ROOT, 'data', 'portfolio');
const INDEX_DIR  = path.join(DATA_DIR, 'indexes');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const SOURCES_FILE = path.join(DATA_DIR, 'company_sources.json');
const COMPANIES_FILE = path.join(DATA_DIR, 'companies.json');

// ── config ──────────────────────────────────────────────────────────────────
const FETCH_TIMEOUT   = 12000;
const DELAY_BETWEEN   = 1500;   // ms between requests (rate-limit courtesy)
const MAX_ITEMS_PER_SOURCE = 8;
const TWITTER_TOKEN   = process.env.TWITTER_BEARER_TOKEN || '';
const BACKFILL        = process.argv.includes('--backfill');

// ── helpers ─────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function itemId(slug, url) {
  const hash = md5(url).substring(0, 8);
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `pf-${d}-${slug}-${hash}`;
}

function stripCDATA(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

function stripHTML(s) { return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (m) return stripCDATA(m[1]).trim();
  if (tag === 'link') {
    const h = xml.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
    if (h) return h[1];
  }
  return '';
}

function truncate(s, len) {
  if (!s || s.length <= len) return s || '';
  return s.substring(0, len).replace(/\s+\S*$/, '') + '...';
}

const BULLISH_KW = /partner|launch|rais|fund|grow|expan|milestone|award|integrat|adopt|secur|approv|list/i;
const BEARISH_KW = /hack|breach|exploit|fine|lawsuit|shut.?down|crash|layoff|delay|vulner|suspend/i;

function detectSentiment(text) {
  if (BULLISH_KW.test(text)) return 'bullish';
  if (BEARISH_KW.test(text)) return 'bearish';
  return 'neutral';
}

// ── significance scoring ──────────────────────────────────────────────────────
// Deterministic, first-match-wins (highest category first), scored 1–9 off the
// title (+ funding tag). Transparent and idempotent — re-running yields the same
// score. The frontend "Portfolio Moves" block surfaces fundings OR score >= 6, so
// M&A / launches / product releases now clear that bar; generic posts stay below it.
const SIG_FUNDING = /rais(e|ed|ing)|seed|pre-seed|series [A-E]|funding round|valuation/i;
const SIG_MA      = /acqui|merger|acquires|acquired|buyout/i;
const SIG_LAUNCH  = /launch|mainnet|goes live|token|TGE|listed|partners with|integrat/i;
const SIG_PRODUCT = /release|unveil|introduc|ships|v\d/i;
const SIG_FUND_TAG = /fund|raise|seed|series|round|investment/i;

function scoreSignificance(item) {
  const title = item.title || '';
  const fundTag = (item.tags || []).some(t => SIG_FUND_TAG.test(String(t)));
  if (fundTag || SIG_FUNDING.test(title)) return 9;   // funding event
  if (SIG_MA.test(title))                 return 8;   // M&A
  if (SIG_LAUNCH.test(title))             return 7;   // launch / partnership / listing
  if (SIG_PRODUCT.test(title))            return 6;   // notable product / release
  return item.source_type === 'news' ? 5 : 4;         // generic: news edges blog
}

function domainFromURL(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// sort key for "newest first": undated (null/invalid) items sink to the bottom
// instead of ranking as epoch-or-now. -8.64e15 is the minimum JS timestamp.
function dateSortKey(d) {
  const t = d ? Date.parse(d) : NaN;
  return isNaN(t) ? -8.64e15 : t;
}

// ── fetch wrapper ───────────────────────────────────────────────────────────
async function safeFetch(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        'User-Agent': 'BlockwallPortfolioBot/1.0',
        ...(opts.headers || {})
      }
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// ── RSS parser ──────────────────────────────────────────────────────────────
function parseRSSItems(xml) {
  const items = [];
  // RSS 2.0
  const rssRegex = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = rssRegex.exec(xml)) !== null) {
    const block = m[1];
    const title = stripHTML(decodeEntities(extractTag(block, 'title')));
    const link  = decodeEntities(stripCDATA(extractTag(block, 'link')).trim());
    const desc  = stripHTML(decodeEntities(extractTag(block, 'description')));
    const pub   = extractTag(block, 'pubDate');
    const src   = stripHTML(decodeEntities(extractTag(block, 'source')));
    if (title && link) items.push({ title, link, description: desc, pubDate: pub, source: src });
  }
  // Atom
  if (items.length === 0) {
    const atomRegex = /<entry>([\s\S]*?)<\/entry>/gi;
    while ((m = atomRegex.exec(xml)) !== null) {
      const block = m[1];
      const title = decodeEntities(stripHTML(extractTag(block, 'title')));
      const link  = extractTag(block, 'link');
      const desc  = decodeEntities(stripHTML(extractTag(block, 'summary') || extractTag(block, 'content')));
      const pub   = extractTag(block, 'published') || extractTag(block, 'updated');
      if (title && link) items.push({ title, link, description: desc, pubDate: pub, source: '' });
    }
  }
  return items;
}

// ── Google News RSS ─────────────────────────────────────────────────────────
async function fetchGoogleNews(query, limit) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const xml = await safeFetch(url);
  return parseRSSItems(xml).slice(0, limit);
}

// ── Blog RSS ────────────────────────────────────────────────────────────────
async function fetchBlogRSS(rssUrl, limit) {
  const xml = await safeFetch(rssUrl);
  return parseRSSItems(xml).slice(0, limit);
}

// ── Substack (CI-safe) ───────────────────────────────────────────────────────
// Substack's RSS /feed is datacenter-blocked (returns 403/empty from GitHub
// runners), which is why river surfaced 0 items in CI while working locally. The
// public JSON archive API is NOT blocked — same endpoint + browser-ish UA that
// scripts/fetch-substack.js uses for the homepage carousel. Route Substack hosts
// through it instead of the RSS feed.
function isSubstackHost(u) {
  try { return /(^|\.)substack\.com$/i.test(new URL(u).hostname); } catch { return false; }
}

// A raw *.substack.com subdomain (unlike the blockwall custom domain that
// fetch-substack.js hits) sits behind Substack's Cloudflare bot-fight edge, which
// 403s non-browser UAs from datacenter IPs on BOTH /feed and /api/v1/archive. So
// present a real desktop-browser UA and try the JSON archive first, then the RSS
// feed as a fallback.
const SUBSTACK_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchSubstackArchive(feedUrl, limit) {
  const origin = new URL(feedUrl).origin;
  const base = { 'user-agent': SUBSTACK_UA, 'accept-language': 'en-US,en;q=0.9' };

  // 1) JSON archive API
  try {
    const apiUrl = `${origin}/api/v1/archive?sort=new&search=&offset=0&limit=${Math.max(limit, 12)}`;
    const body = await safeFetch(apiUrl, { headers: { ...base, accept: 'application/json' } });
    const arr = JSON.parse(body);
    if (Array.isArray(arr) && arr.length) {
      return arr
        .filter(p => p && p.title && p.canonical_url)
        .slice(0, limit)
        .map(p => ({
          title:       p.title,
          link:        p.canonical_url,
          description: p.description || p.subtitle || '',
          pubDate:     p.post_date || null,
          source:      'Substack',
          image:       p.cover_image || null,
        }));
    }
  } catch (e) {
    console.log(`    substack-api: ${e.message} — falling back to RSS`);
  }

  // 2) RSS feed fallback (same browser UA)
  const xml = await safeFetch(feedUrl, { headers: { ...base, accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8' } });
  return parseRSSItems(xml).slice(0, limit);
}

// ── X / Twitter API v2 ─────────────────────────────────────────────────────
async function fetchXPosts(handle, limit) {
  if (!TWITTER_TOKEN || !handle) return [];
  try {
    // resolve user ID
    const userJson = await safeFetch(
      `https://api.twitter.com/2/users/by/username/${handle}`,
      { headers: { Authorization: `Bearer ${TWITTER_TOKEN}` } }
    );
    const userId = JSON.parse(userJson).data?.id;
    if (!userId) return [];

    const tweetsJson = await safeFetch(
      `https://api.twitter.com/2/users/${userId}/tweets?max_results=${Math.min(limit, 10)}&tweet.fields=created_at,text`,
      { headers: { Authorization: `Bearer ${TWITTER_TOKEN}` } }
    );
    const tweets = JSON.parse(tweetsJson).data || [];
    return tweets.map(t => ({
      title: truncate(t.text.replace(/\n/g, ' '), 120),
      link: `https://x.com/${handle}/status/${t.id}`,
      description: t.text,
      pubDate: t.created_at,
      source: 'X'
    }));
  } catch (e) {
    console.log(`    X API error for @${handle}: ${e.message}`);
    return [];
  }
}

// ── convert raw feed item → portfolio item ──────────────────────────────────
function toPortfolioItem(slug, companyName, raw, sourceType) {
  const title = raw.title || 'Untitled';
  const url   = raw.link;
  const text  = `${title} ${raw.description || ''}`;
  // honest date: keep null when missing/invalid — do NOT fake "today" (sorts to bottom)
  let pubDate = null;
  if (raw.pubDate) {
    const _d = new Date(raw.pubDate);
    if (!isNaN(_d.getTime())) pubDate = _d.toISOString();
  }

  const item = {
    id:                itemId(slug, url),
    company_slug:      slug,
    company_name:      companyName,
    date_published:    pubDate,
    date_ingested:     new Date().toISOString(),
    source_type:       sourceType,
    title:             truncate(title, 200),
    url:               url,
    publisher:         raw.source || domainFromURL(url),
    summary_short:     truncate(raw.description || '', 280),
    image_url:         raw.image || null,
    significance_score: 5,
    sentiment:         detectSentiment(text),
    tags:              []
  };
  item.significance_score = scoreSignificance(item);
  return item;
}

// ── collect for one company (routed by company_sources.json "method") ────────
// Returns the candidates that PASS the registry validator. Raw/kept/drop stats
// are accumulated on ctx for the end-of-run report.
async function collectCompany(slug, cfg, ctx) {
  const limit = MAX_ITEMS_PER_SOURCE;
  const candidates = [];
  const method = cfg.method || 'news';

  if (method === 'feed') {
    // blog_rss path — Substack hosts go through the CI-safe JSON archive API
    if (cfg.blog_rss) {
      const substack = isSubstackHost(cfg.blog_rss);
      try {
        const raw = substack
          ? await fetchSubstackArchive(cfg.blog_rss, limit)
          : await fetchBlogRSS(cfg.blog_rss, limit);
        for (const r of raw) candidates.push(toPortfolioItem(slug, cfg.name, r, 'blog'));
        console.log(`    feed:    ${raw.length} items  (${substack ? 'substack-api ' : ''}${cfg.blog_rss})`);
      } catch (e) {
        console.log(`    feed failed: ${e.message}  (${cfg.blog_rss})`);
      }
    } else {
      console.log(`    feed:    no blog_rss set — skipped`);
    }
    await sleep(DELAY_BETWEEN);

  } else if (method === 'sitemap') {
    // sitemap-diff + blog-index scrape (FIX C) + og-extract. A company may have a sitemap,
    // a blog_index, or both (blog_index also gives a source to companies with no sitemap/feed).
    if (cfg.sitemap || cfg.blog_index) {
      const srcUrl = cfg.sitemap || cfg.blog_index;
      try {
        const res = await sitemap.collectNewFromSitemap(
          { slug, sitemapUrl: cfg.sitemap, domain: ctx.domainBySlug[slug], blogIndexUrl: cfg.blog_index },
          ctx.seenUrls,          // existing items.json URLs (dedup set)
          { maxNew: 20 }         // seed run; tune later
        );
        if (res.ok) {
          for (const it of res.items) {
            candidates.push(toPortfolioItem(slug, cfg.name, {
              title: it.title, link: it.url, description: it.summary,
              pubDate: it.date, source: it.publisher, image: it.image_url,
            }, it.source_type || 'blog'));
          }
          const via = cfg.blog_index ? ` [${res.sitemap} sitemap + ${res.blogIndex} blog-index]` : '';
          console.log(`    sitemap: ${res.new} new of ${res.discovered} post URLs${via}  (${srcUrl})`);
        } else {
          console.log(`    sitemap failed: ${res.error}  (${srcUrl})`);
        }
      } catch (e) {
        console.log(`    sitemap failed: ${e.message}  (${srcUrl})`);
      }
    } else {
      console.log(`    sitemap: no sitemap/blog_index url set — skipped`);
    }
    await sleep(DELAY_BETWEEN);

  } else {
    // method === 'news' (and any unknown method): Google-News path.
    // FIX B: Google News now serves opaque .../articles/CBMi… redirect URLs, so the
    // validator's domain/text match can't fire. Decode each to the real publisher URL
    // and enrich from that article's og so the (tightened) identifiers can match on the
    // real title/description. A company with query:null/"" is intentionally disabled
    // (Google News returns only namesake junk for it — e.g. blinklabs/opfn/portmarkets).
    if (method !== 'news') console.log(`    (unknown method "${method}" — falling back to news)`);
    if (!cfg.query) {
      console.log(`    news:    disabled (no query — Google News too noisy for this entity)`);
    } else {
      try {
        const raw = await fetchGoogleNews(cfg.query, limit);
        let resolved = 0, unresolved = 0, seenSkip = 0;
        for (const r of raw) {
          const realUrl = await gnews.decodeGoogleNewsUrl(r.link).catch(() => null);
          if (!realUrl || /news\.google\./.test(realUrl)) { unresolved++; continue; }  // opaque link is useless downstream
          if (ctx.seenUrls.has(realUrl)) { seenSkip++; continue; }                      // already ingested — skip the enrich fetch
          resolved++;
          const og = await sitemap.extractOg(realUrl).catch(() => ({ ok: false }));
          const nItem = toPortfolioItem(slug, cfg.name, {
            title:       (og.ok && og.title) || r.title,
            link:        realUrl,
            description: (og.ok && og.description) || r.description,
            pubDate:     (og.ok && og.published) || r.pubDate,
            source:      (og.ok && og.site_name) || r.source || domainFromURL(realUrl),
            image:       (og.ok && og.image) || null,
          }, 'news');
          if (og.ok && og.text) nItem._matchText = og.text;   // body sample for validation only
          candidates.push(nItem);
          await sleep(400);   // politeness: decode = 2 reqs + og = 1 req per item
        }
        console.log(`    news:    ${raw.length} fetched → ${resolved} resolved+enriched, ${seenSkip} already-seen, ${unresolved} unresolvable  (${cfg.query})`);
      } catch (e) {
        console.log(`    news failed: ${e.message}`);
      }
    }
    await sleep(DELAY_BETWEEN);
  }

  // X / Twitter — UNCHANGED (separate later milestone; skipped without token)
  if (cfg.x_handle && TWITTER_TOKEN) {
    try {
      const raw = await fetchXPosts(cfg.x_handle, 5);
      for (const r of raw) candidates.push(toPortfolioItem(slug, cfg.name, r, 'x'));
      console.log(`    X posts: ${raw.length} items`);
    } catch (e) {
      console.log(`    X failed: ${e.message}`);
    }
    await sleep(DELAY_BETWEEN);
  }

  ctx.fetchedBySlug[slug] = candidates.length;

  // ── validator gate — BEFORE dedup/save ──
  // feed/sitemap items are on the company domain or a trusted host -> pass ("on-domain").
  // this mainly filters the Google-News path's name-collision noise.
  const v = (ctx.validators && ctx.validators[slug]) || (() => ({ ok: true, reason: 'no-validator' }));
  const kept = candidates.filter(it => {
    const r = v({ url: it.url, title: it.title, summary: it.summary_short, publisher: it.publisher, matchText: it._matchText });
    delete it._matchText;   // drop the bulky body sample — never stored
    // persist the compact body signal (the matched founder) so the self-healing re-validation
    // pass can reproduce a body-only match on the stored item (which no longer carries the body).
    if (r.ok && r.reason === 'founder-body' && r.signal) it.matchText = r.signal;
    if (!r.ok) {
      ctx.drops.total++;
      const line = `  drop [${slug}] ${r.reason}  ${it.url}`;
      if (ctx.drops.samples.length < 60) ctx.drops.samples.push(line);
      console.log(line);
    }
    return r.ok;
  });
  ctx.keptBySlug[slug] = kept.length;
  return kept;
}

// ── deduplication ───────────────────────────────────────────────────────────
function dedup(existingItems, newItems) {
  const seen = new Set(existingItems.map(i => i.url));
  const added = [];
  for (const item of newItems) {
    if (!seen.has(item.url)) {
      seen.add(item.url);
      added.push(item);
    }
  }
  return added;
}

// ── self-healing normalize pass (runs over the ENTIRE stored set every run) ────
// Dedup only ever ADDS, so stale baseline items (mislabels from the old registry,
// future-dated posts, build-artifact timestamps, locale translations) never leave
// on their own. This pass re-applies the current validators + heuristics to every
// stored item so the corpus self-heals: bad items drop, dates get honest, scores
// get recomputed. Non-destructive in spirit — it only removes items that FAIL the
// current rules, and legit history (which still passes) stays.
function normalizeAndHeal(items, ctx) {
  const NOW = Date.now();
  const stats = { revalidated_dropped: 0, locale_dropped: 0, future_clamped: 0, cluster_nulled: 0, samples: [] };
  const sample = (line) => { if (stats.samples.length < 40) stats.samples.push(line); };

  // (#6) registry identity + re-validation: drop items that no longer belong to
  // their company under the CURRENT registry (e.g. the river=Towns mislabel).
  let kept = items.filter(it => {
    const v = ctx.validators[it.company_slug];
    if (!v) { stats.revalidated_dropped++; sample(`  heal-drop [${it.company_slug}] no-registry-entry  ${it.url}`); return false; }
    // pass the persisted body signal (matchText) so a founder-body match survives re-validation.
    const r = v({ url: it.url, title: it.title, summary: it.summary_short, publisher: it.publisher, matchText: it.matchText });
    if (!r.ok) { stats.revalidated_dropped++; sample(`  heal-drop [${it.company_slug}] ${r.reason}  ${it.url}`); return false; }
    return true;
  });

  // (#5) preferred-locale filter: drop non-English locale translations of stored
  // items (the sitemap module already filters these for NEW discoveries).
  kept = kept.filter(it => {
    if (sitemap.isPreferredLocaleUrl(it.url)) return true;
    stats.locale_dropped++; sample(`  heal-drop [${it.company_slug}] non-pref-locale  ${it.url}`);
    return false;
  });

  // (#4a) future-date clamp: a date_published after "now" can't be a real publish
  // time — pin it to date_ingested (the real first-seen time) so it stops floating
  // to the top of newest-first views.
  for (const it of kept) {
    const t = it.date_published ? Date.parse(it.date_published) : NaN;
    if (!isNaN(t) && t > NOW) { it.date_published = it.date_ingested || null; stats.future_clamped++; }
  }

  // (#4b) uniform-lastmod cluster null: when a single company has the IDENTICAL
  // timestamp on more than 3 items, that's a sitemap build-date artifact, not real
  // publish dates — null them so they sink as honestly undated instead of clustering
  // at a fake-precise time.
  const tsCount = {};
  for (const it of kept) {
    if (!it.date_published) continue;
    (tsCount[it.company_slug] = tsCount[it.company_slug] || {});
    tsCount[it.company_slug][it.date_published] = (tsCount[it.company_slug][it.date_published] || 0) + 1;
  }
  for (const it of kept) {
    if (it.date_published && (tsCount[it.company_slug][it.date_published] || 0) > 3) {
      it.date_published = null; stats.cluster_nulled++;
    }
  }

  // (#1) significance re-scoring: deterministic + idempotent, applied to the whole
  // corpus so existing items leave the old uniform-5 placeholder behind.
  for (const it of kept) it.significance_score = scoreSignificance(it);

  ctx.healStats = stats;
  return kept;
}

// ── index generation ────────────────────────────────────────────────────────
function generateIndexes(allItems) {
  const now = new Date().toISOString();

  // sort newest first (undated items sink to the bottom)
  allItems.sort((a, b) => dateSortKey(b.date_published) - dateSortKey(a.date_published));

  // 1. latest.json — top 50
  const latestDir = INDEX_DIR;
  fs.mkdirSync(latestDir, { recursive: true });
  fs.writeFileSync(path.join(latestDir, 'latest.json'), JSON.stringify({
    items: allItems.slice(0, 50),
    generated_at: now
  }, null, 2));

  // 2. by-company/<slug>.json
  const byCoDir = path.join(INDEX_DIR, 'by-company');
  fs.mkdirSync(byCoDir, { recursive: true });
  const byCompany = {};
  for (const item of allItems) {
    if (!byCompany[item.company_slug]) byCompany[item.company_slug] = [];
    byCompany[item.company_slug].push(item);
  }
  for (const [slug, items] of Object.entries(byCompany)) {
    fs.writeFileSync(path.join(byCoDir, `${slug}.json`), JSON.stringify({
      company_slug: slug,
      items,
      generated_at: now
    }, null, 2));
  }
  // Also write empty files for companies with no items
  const sources = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8'));
  for (const slug of Object.keys(sources)) {
    const f = path.join(byCoDir, `${slug}.json`);
    if (!fs.existsSync(f)) {
      fs.writeFileSync(f, JSON.stringify({ company_slug: slug, items: [], generated_at: now }, null, 2));
    }
  }

  // 3. daily index
  const dailyDir = path.join(INDEX_DIR, 'daily');
  fs.mkdirSync(dailyDir, { recursive: true });
  const byDate = {};
  for (const item of allItems) {
    if (!item.date_published) continue;   // undated -> excluded from daily (don't bucket as today)
    const d = item.date_published.slice(0, 10);
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(item);
  }
  const dates = Object.keys(byDate).sort().reverse().map(d => ({
    date: d,
    item_count: byDate[d].length,
    company_count: new Set(byDate[d].map(i => i.company_slug)).size
  }));
  fs.writeFileSync(path.join(dailyDir, 'index.json'), JSON.stringify({ dates, generated_at: now }, null, 2));
  for (const [d, items] of Object.entries(byDate)) {
    fs.writeFileSync(path.join(dailyDir, `${d}.json`), JSON.stringify({ date: d, items, generated_at: now }, null, 2));
  }

  console.log(`\nIndexes generated:`);
  console.log(`  latest.json        — ${Math.min(allItems.length, 50)} items`);
  console.log(`  by-company/        — ${Object.keys(byCompany).length} company files`);
  console.log(`  daily/             — ${dates.length} date files`);
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Blockwall Portfolio Collector ===\n');
  if (TWITTER_TOKEN) console.log('X API token detected — will fetch tweets.\n');
  else console.log('No TWITTER_BEARER_TOKEN set — skipping X posts.\n');

  // load sources (routing) + registry (identifiers live in companies.json, NOT here)
  const sources = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8'));
  const registry = JSON.parse(fs.readFileSync(COMPANIES_FILE, 'utf8'));
  const slugs = Object.keys(sources);
  console.log(`Companies: ${slugs.length}\n`);

  // trusted off-domain feed hosts (Substack / blog subdomains) for the validator
  const TRUSTED = {
    river:           ['irlurl.substack.com'],
    busha:           ['blog.busha.io'],
    validationcloud: ['blog.validationcloud.io'],
    zealy:           ['blog.zealy.io'],
  };
  const validators = buildValidators(registry, TRUSTED);
  const domainBySlug = {};
  for (const c of (registry.companies || [])) domainBySlug[c.slug] = c.domain;

  // load existing items + build the seen-URL set (used by dedup AND the sitemap module)
  let existing = [];
  try {
    const data = JSON.parse(fs.readFileSync(ITEMS_FILE, 'utf8'));
    existing = data.items || [];
  } catch { /* first run */ }
  const seenUrls = new Set(existing.map(i => i.url));

  const ctx = {
    validators, domainBySlug, seenUrls,
    drops: { total: 0, samples: [] },
    fetchedBySlug: {}, keptBySlug: {},
  };

  // collect (routed by method)
  const allNew = [];
  for (const slug of slugs) {
    console.log(`[${slug}]  method=${sources[slug].method || 'news'}`);
    try {
      const items = await collectCompany(slug, sources[slug], ctx);
      allNew.push(...items);
    } catch (e) {
      console.log(`  FAILED: ${e.message}`);
    }
  }

  // merge + dedup, then self-heal the WHOLE set (re-validate / re-date / re-score)
  const added = dedup(existing, allNew);
  const beforeHeal = existing.length + added.length;
  const merged = normalizeAndHeal([...existing, ...added], ctx);
  merged.sort((a, b) => dateSortKey(b.date_published) - dateSortKey(a.date_published));

  // per-company report: fetched (raw) -> kept (passed validator) -> new (after dedup)
  const newBySlug = {};
  for (const it of added) newBySlug[it.company_slug] = (newBySlug[it.company_slug] || 0) + 1;
  console.log(`\n── per-company  (method | fetched -> kept -> new) ──`);
  for (const slug of slugs) {
    const f = ctx.fetchedBySlug[slug] || 0, k = ctx.keptBySlug[slug] || 0, n = newBySlug[slug] || 0;
    console.log(`  ${slug.padEnd(16)} ${String(sources[slug].method || 'news').padEnd(8)} ${String(f).padStart(3)} -> ${String(k).padStart(3)} -> ${String(n).padStart(3)}`);
  }

  // validator drops (new candidates rejected at ingest)
  console.log(`\n── validator drops (new candidates): ${ctx.drops.total} total ──`);
  for (const line of ctx.drops.samples.slice(0, 25)) console.log(line);
  if (ctx.drops.total > 25) console.log(`  … and ${ctx.drops.total - 25} more (see inline "drop [...]" lines above)`);

  // self-healing re-validation over the stored corpus
  const hs = ctx.healStats || { revalidated_dropped: 0, locale_dropped: 0, future_clamped: 0, cluster_nulled: 0, samples: [] };
  const healedDropped = hs.revalidated_dropped + hs.locale_dropped;
  console.log(`\n── self-heal pass (whole corpus: ${beforeHeal} -> ${merged.length}) ──`);
  console.log(`  re-validation dropped : ${hs.revalidated_dropped}  (stale mislabels / namesakes)`);
  console.log(`  locale dropped        : ${hs.locale_dropped}  (non-English translations)`);
  console.log(`  future-dates clamped  : ${hs.future_clamped}  (-> date_ingested)`);
  console.log(`  cluster-dates nulled  : ${hs.cluster_nulled}  (build-artifact timestamps)`);
  for (const line of hs.samples.slice(0, 30)) console.log(line);
  if (healedDropped > 30) console.log(`  … and ${healedDropped - 30} more heal-drops`);

  // significance distribution (sanity: should be varied, not all 5)
  const sigDist = {};
  for (const it of merged) sigDist[it.significance_score] = (sigDist[it.significance_score] || 0) + 1;
  const sigLine = Object.keys(sigDist).sort((a, b) => b - a).map(s => `${s}:${sigDist[s]}`).join('  ');
  console.log(`\n── significance distribution ──\n  ${sigLine}`);

  console.log(`\nResults: ${allNew.length} validated-fetched, ${added.length} new, ${merged.length} stored after self-heal (was ${existing.length})`);

  // save items.json
  const itemsData = {
    last_updated: new Date().toISOString(),
    total_items: merged.length,
    items: merged
  };
  fs.writeFileSync(ITEMS_FILE, JSON.stringify(itemsData, null, 2));
  console.log(`Saved ${merged.length} items to items.json`);

  // generate all indexes
  generateIndexes(merged);

  // update portfolio.json (daily digest archive)
  updatePortfolioJSON(merged);

  console.log('\nDone.');
}

function updatePortfolioJSON(items) {
  const pFile = path.join(ROOT, 'data', 'portfolio.json');
  let existing = [];
  try { existing = JSON.parse(fs.readFileSync(pFile, 'utf8')); } catch {}

  // group items by date
  const byDate = {};
  for (const item of items) {
    if (!item.date_published) continue;   // undated -> excluded from the daily digest archive
    const d = item.date_published.slice(0, 10);
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(item);
  }

  // merge into portfolio.json (keep existing entries, add new dates)
  const existingDates = new Set(existing.map(e => e.date));
  for (const [date, dateItems] of Object.entries(byDate)) {
    if (!existingDates.has(date)) {
      const bullish = dateItems.filter(i => i.sentiment === 'bullish').length;
      const bearish = dateItems.filter(i => i.sentiment === 'bearish').length;
      existing.push({
        date,
        filename: `blockwall-portfolio-${date}.html`,
        title: 'Daily Portfolio Digest',
        updates: dateItems.length,
        companies: new Set(dateItems.map(i => i.company_slug)).size,
        bullish,
        bearish
      });
    }
  }
  existing.sort((a, b) => b.date.localeCompare(a.date));
  fs.writeFileSync(pFile, JSON.stringify(existing, null, 2));
}

// Export pure helpers for offline testing; only run the network collector when
// invoked directly (node collect-portfolio-updates.js).
module.exports = { scoreSignificance, normalizeAndHeal, isSubstackHost, dedup };

if (require.main === module) {
  main().catch(e => { console.error('Fatal:', e); process.exit(1); });
}
