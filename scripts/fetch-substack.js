#!/usr/bin/env node
/*
 * Refresh data/substack.json from the public Substack archive API.
 *
 * Why a script (not a client-side fetch): the Substack API sends NO CORS header,
 * so the browser can't read it cross-origin from the GitHub Pages site. This runs
 * server-side (locally or in the refresh-substack GitHub Action) and writes the
 * static data/substack.json that assets/js/render-home.js already renders.
 *
 * No external deps — Node 18+ global fetch. Atomic + safe: if the fetch fails or
 * returns nothing parseable, it exits non-zero and LEAVES the existing file intact.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const PUB = process.env.SUBSTACK_PUB || "https://insights.blockwall.vc";
const LIMIT = Number(process.env.SUBSTACK_LIMIT || 15); // most-recent N posts
const OUT = path.join(__dirname, "..", "data", "substack.json");
const PAGE = 12;

async function getPage(offset) {
  const url = `${PUB}/api/v1/archive?sort=new&search=&offset=${offset}&limit=${PAGE}`;
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "blockwall-insights-site/1.0 (+refresh-substack)" } });
  if (!res.ok) throw new Error(`archive offset=${offset}: HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error(`archive offset=${offset}: unexpected payload`);
  return json;
}

async function main() {
  const all = [];
  for (let offset = 0; offset < LIMIT + PAGE; offset += PAGE) {
    const page = await getPage(offset);
    all.push(...page);
    if (page.length < PAGE) break; // last page
  }
  const posts = all
    .filter((p) => p && p.title && p.canonical_url)
    .slice(0, LIMIT)
    .map((p) => ({
      title: String(p.title).trim(),
      url: p.canonical_url,
      image: p.cover_image || null,
      author: (p.publishedBylines && p.publishedBylines[0] && p.publishedBylines[0].name) || "Blockwall",
      date: p.post_date || null,
    }));
  if (!posts.length) throw new Error("parsed 0 posts — aborting, keeping existing data/substack.json");
  fs.writeFileSync(OUT, JSON.stringify(posts, null, 2) + "\n");
  console.log(`Wrote ${posts.length} Substack posts to data/substack.json (newest: ${posts[0].title})`);
}

main().catch((e) => {
  console.error("fetch-substack failed:", e && e.message ? e.message : e);
  process.exit(1);
});
