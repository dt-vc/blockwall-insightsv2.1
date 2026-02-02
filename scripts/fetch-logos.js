#!/usr/bin/env node
/**
 * fetch-logos.js
 * Downloads company logos using Clearbit Logo API + Google favicon fallback.
 * Saves to assets/companies/<slug>.png
 *
 * Usage:  node scripts/fetch-logos.js
 * Deps:   Node 18+ (built-in fetch)
 */

const fs   = require('fs');
const path = require('path');

const ROOT      = path.join(__dirname, '..');
const SRC_FILE  = path.join(ROOT, 'data', 'portfolio', 'company_sources.json');
const OUT_DIR   = path.join(ROOT, 'assets', 'companies');
const TIMEOUT   = 10000;
const DELAY     = 800;       // ms between requests to be polite

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const id   = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

async function downloadLogo(slug, domain) {
  const outPath = path.join(OUT_DIR, `${slug}.png`);

  // Skip if already downloaded
  if (fs.existsSync(outPath)) {
    const stat = fs.statSync(outPath);
    if (stat.size > 500) {   // real image > 500 bytes
      console.log(`  [skip] ${slug}.png already exists (${stat.size} bytes)`);
      return true;
    }
  }

  // Try Clearbit Logo API first (returns 200x200 PNG)
  const clearbitUrl = `https://logo.clearbit.com/${domain}?size=200&format=png`;
  try {
    const res = await fetchWithTimeout(clearbitUrl, TIMEOUT);
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('image')) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 500) {
          fs.writeFileSync(outPath, buf);
          console.log(`  [clearbit] ${slug}.png  (${buf.length} bytes)`);
          return true;
        }
      }
    }
  } catch (_) { /* fall through */ }

  // Fallback: Google Favicon service (128px)
  const googleUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
  try {
    const res = await fetchWithTimeout(googleUrl, TIMEOUT);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 200) {
        fs.writeFileSync(outPath, buf);
        console.log(`  [google]   ${slug}.png  (${buf.length} bytes)`);
        return true;
      }
    }
  } catch (_) { /* fall through */ }

  // Generate SVG placeholder as final fallback
  const initials = slug.slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#6366f1"/><stop offset="100%" stop-color="#a855f7"/></linearGradient></defs>
  <rect width="200" height="200" rx="40" fill="url(#g)"/>
  <text x="100" y="115" font-family="Inter,system-ui,sans-serif" font-size="72" font-weight="700" fill="white" text-anchor="middle">${initials}</text>
</svg>`;
  const svgPath = path.join(OUT_DIR, `${slug}.svg`);
  fs.writeFileSync(svgPath, svg);
  console.log(`  [placeholder] ${slug}.svg  (SVG fallback)`);
  return false;
}

async function main() {
  console.log('Fetching company logos...\n');

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const sources = JSON.parse(fs.readFileSync(SRC_FILE, 'utf-8'));
  const slugs   = Object.keys(sources);
  let ok = 0, fallback = 0;

  for (const slug of slugs) {
    const domain = sources[slug].website;
    console.log(`${sources[slug].name} (${domain})`);
    const success = await downloadLogo(slug, domain);
    if (success) ok++; else fallback++;
    await sleep(DELAY);
  }

  console.log(`\nDone: ${ok} logos downloaded, ${fallback} placeholders created.`);
  console.log(`Output: ${OUT_DIR}/`);
}

main().catch(e => { console.error(e); process.exit(1); });
