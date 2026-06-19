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

  return {
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
}

// ── collect for one company (routed by company_sources.json "method") ────────
// Returns the candidates that PASS the registry validator. Raw/kept/drop stats
// are accumulated on ctx for the end-of-run report.
async function collectCompany(slug, cfg, ctx) {
  const limit = MAX_ITEMS_PER_SOURCE;
  const candidates = [];
  const method = cfg.method || 'news';

  if (method === 'feed') {
    // existing blog_rss path (unchanged)
    if (cfg.blog_rss) {
      try {
        const raw = await fetchBlogRSS(cfg.blog_rss, limit);
        for (const r of raw) candidates.push(toPortfolioItem(slug, cfg.name, r, 'blog'));
        console.log(`    feed:    ${raw.length} items  (${cfg.blog_rss})`);
      } catch (e) {
        console.log(`    feed failed: ${e.message}  (${cfg.blog_rss})`);
      }
    } else {
      console.log(`    feed:    no blog_rss set — skipped`);
    }
    await sleep(DELAY_BETWEEN);

  } else if (method === 'sitemap') {
    // NEW: sitemap-diff + og-extract (inert metadata becomes live here)
    if (cfg.sitemap) {
      try {
        const res = await sitemap.collectNewFromSitemap(
          { slug, sitemapUrl: cfg.sitemap, domain: ctx.domainBySlug[slug] },
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
          console.log(`    sitemap: ${res.new} new of ${res.discovered} post URLs  (${cfg.sitemap})`);
        } else {
          console.log(`    sitemap failed: ${res.error}  (${cfg.sitemap})`);
        }
      } catch (e) {
        console.log(`    sitemap failed: ${e.message}  (${cfg.sitemap})`);
      }
    } else {
      console.log(`    sitemap: no sitemap url set — skipped`);
    }
    await sleep(DELAY_BETWEEN);

  } else {
    // method === 'news' (and any unknown method): existing Google-News path
    if (method !== 'news') console.log(`    (unknown method "${method}" — falling back to news)`);
    try {
      const raw = await fetchGoogleNews(cfg.query, limit);
      for (const r of raw) candidates.push(toPortfolioItem(slug, cfg.name, r, 'news'));
      console.log(`    news:    ${raw.length} items  (${cfg.query})`);
    } catch (e) {
      console.log(`    news failed: ${e.message}`);
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
    const r = v({ url: it.url, title: it.title, summary: it.summary_short, publisher: it.publisher });
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

  // merge + dedup
  const added = dedup(existing, allNew);
  const merged = [...existing, ...added];
  merged.sort((a, b) => dateSortKey(b.date_published) - dateSortKey(a.date_published));

  // per-company report: fetched (raw) -> kept (passed validator) -> new (after dedup)
  const newBySlug = {};
  for (const it of added) newBySlug[it.company_slug] = (newBySlug[it.company_slug] || 0) + 1;
  console.log(`\n── per-company  (method | fetched -> kept -> new) ──`);
  for (const slug of slugs) {
    const f = ctx.fetchedBySlug[slug] || 0, k = ctx.keptBySlug[slug] || 0, n = newBySlug[slug] || 0;
    console.log(`  ${slug.padEnd(16)} ${String(sources[slug].method || 'news').padEnd(8)} ${String(f).padStart(3)} -> ${String(k).padStart(3)} -> ${String(n).padStart(3)}`);
  }

  // validator drops
  console.log(`\n── validator drops: ${ctx.drops.total} total ──`);
  for (const line of ctx.drops.samples.slice(0, 25)) console.log(line);
  if (ctx.drops.total > 25) console.log(`  … and ${ctx.drops.total - 25} more (see inline "drop [...]" lines above)`);

  console.log(`\nResults: ${allNew.length} validated-fetched, ${added.length} new (${existing.length} existing)`);

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

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
