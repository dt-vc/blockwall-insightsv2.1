#!/usr/bin/env python3
"""
Blockwall Portfolio - Weekly Company Data Updater

Scrapes portfolio company websites and searches for recent news to keep
company profiles up-to-date. Uses crawl4ai for web scraping and Google
News RSS for news discovery.

Usage:
  python update_portfolio_weekly.py                  # Update all companies
  python update_portfolio_weekly.py --company busha  # Update single company
  python update_portfolio_weekly.py --dry-run        # Preview without writing
  python update_portfolio_weekly.py --news-only      # Only fetch news, skip blogs
  python update_portfolio_weekly.py --blogs-only     # Only fetch blogs, skip news

Requirements (auto-installed on first run):
  pip install crawl4ai feedparser requests
"""

import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote_plus, urlparse

# ---------------------------------------------------------------------------
# Auto-install dependencies
# ---------------------------------------------------------------------------
REQUIRED = {"crawl4ai": "crawl4ai", "feedparser": "feedparser", "requests": "requests"}

for mod, pkg in REQUIRED.items():
    try:
        __import__(mod)
    except ImportError:
        print(f"Installing {pkg}...")
        os.system(f"{sys.executable} -m pip install -q {pkg}")

import feedparser
import requests

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"
PORTFOLIO_DIR = DATA_DIR / "portfolio"
BLOG_DIR = PORTFOLIO_DIR / "blog"
INDEX_DIR = PORTFOLIO_DIR / "indexes"
BY_COMPANY_DIR = INDEX_DIR / "by-company"

COMPANIES_JSON = PORTFOLIO_DIR / "companies.json"
SOURCES_JSON = PORTFOLIO_DIR / "company_sources.json"
LATEST_VALIDATED = INDEX_DIR / "latest-validated.json"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
NEWS_LOOKBACK_DAYS = 14  # How far back to search for news
MAX_NEWS_PER_COMPANY = 10
MAX_BLOG_POSTS = 10
REQUEST_TIMEOUT = 15

# Google News RSS base
GNEWS_RSS = "https://news.google.com/rss/search?q={query}&hl=en&gl=US&ceid=US:en"


def log(msg, level="info"):
    icons = {"info": "  ", "ok": "  \u2705", "warn": "  \u26a0\ufe0f", "err": "  \u274c", "head": "\n\U0001f4e6"}
    print(f"{icons.get(level, '  ')} {msg}")


# ---------------------------------------------------------------------------
# Data loaders
# ---------------------------------------------------------------------------
def load_json(path: Path, default=None):
    if not path.exists():
        return default if default is not None else {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data, dry_run=False):
    if dry_run:
        log(f"[DRY RUN] Would write {path.name}", "warn")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def make_id(slug: str, title: str, url: str) -> str:
    h = hashlib.md5(f"{slug}-{url}".encode()).hexdigest()[:8]
    date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"pf-{date_str}-{slug}-{h}"


# ---------------------------------------------------------------------------
# RSS / Blog fetching
# ---------------------------------------------------------------------------
def fetch_rss_posts(rss_url: str, slug: str) -> list:
    """Fetch posts from an RSS feed URL."""
    posts = []
    try:
        feed = feedparser.parse(rss_url)
        for entry in feed.entries[:MAX_BLOG_POSTS]:
            pub_date = ""
            if hasattr(entry, "published_parsed") and entry.published_parsed:
                pub_date = datetime(*entry.published_parsed[:6]).strftime("%Y-%m-%d")
            elif hasattr(entry, "updated_parsed") and entry.updated_parsed:
                pub_date = datetime(*entry.updated_parsed[:6]).strftime("%Y-%m-%d")

            excerpt = ""
            if hasattr(entry, "summary"):
                excerpt = re.sub(r"<[^>]+>", "", entry.summary)[:300].strip()

            posts.append({
                "id": f"{slug}-{hashlib.md5(entry.link.encode()).hexdigest()[:6]}",
                "title": entry.get("title", "Untitled"),
                "url": entry.link,
                "date_published": pub_date,
                "excerpt": excerpt,
                "author": entry.get("author", ""),
            })
    except Exception as e:
        log(f"RSS fetch failed for {rss_url}: {e}", "warn")
    return posts


# ---------------------------------------------------------------------------
# Website blog scraping via crawl4ai
# ---------------------------------------------------------------------------
async def scrape_company_blog(website: str, slug: str, company_name: str) -> list:
    """Use crawl4ai to scrape a company's blog/news page for recent posts."""
    try:
        from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig
    except ImportError:
        log("crawl4ai not available, skipping website scrape", "warn")
        return []

    posts = []
    blog_paths = ["/blog", "/news", "/updates", "/articles", "/insights", "/resources"]
    base_url = f"https://{website}" if not website.startswith("http") else website

    browser_cfg = BrowserConfig(headless=True, verbose=False)
    run_cfg = CrawlerRunConfig(
        word_count_threshold=10,
        excluded_tags=["nav", "footer", "header", "aside"],
        wait_until="domcontentloaded",
    )

    async with AsyncWebCrawler(config=browser_cfg) as crawler:
        for path in blog_paths:
            url = f"{base_url}{path}"
            try:
                result = await crawler.arun(url=url, config=run_cfg)
                if not result.success or not result.links:
                    continue

                # Extract article-like links from the blog page
                seen_urls = set()
                for link_info in result.links.get("internal", []):
                    href = link_info.get("href", "")
                    text = link_info.get("text", "").strip()

                    if not text or len(text) < 15 or len(text) > 300:
                        continue
                    if href in seen_urls:
                        continue
                    # Filter for article-like URLs
                    skip_patterns = [
                        "/tag/", "/category/", "/author/", "/page/",
                        "#", "/login", "/signup", "/contact", "/about",
                        "/privacy", "/terms", "/careers",
                    ]
                    if any(p in href.lower() for p in skip_patterns):
                        continue

                    seen_urls.add(href)
                    full_url = href if href.startswith("http") else f"{base_url}{href}"

                    posts.append({
                        "id": f"{slug}-{hashlib.md5(full_url.encode()).hexdigest()[:6]}",
                        "title": text,
                        "url": full_url,
                        "date_published": "",  # Will be enriched later if possible
                        "excerpt": "",
                        "author": company_name,
                    })

                if posts:
                    log(f"Found {len(posts)} posts on {url}", "ok")
                    break  # Found a working blog page
            except Exception:
                continue

    return posts[:MAX_BLOG_POSTS]


# ---------------------------------------------------------------------------
# News search via Google News RSS
# ---------------------------------------------------------------------------
def fetch_google_news(query: str, slug: str, company_name: str) -> list:
    """Search Google News RSS for recent articles about a company."""
    items = []
    # Add time filter: only last N days
    when_param = f" when:{NEWS_LOOKBACK_DAYS}d"
    full_query = quote_plus(query + when_param)
    url = GNEWS_RSS.format(query=full_query)

    try:
        resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()

        root = ET.fromstring(resp.content)
        for item in root.findall(".//item")[:MAX_NEWS_PER_COMPANY]:
            title = item.findtext("title", "")
            link = item.findtext("link", "")
            pub_date_str = item.findtext("pubDate", "")
            source = item.findtext("source", "")

            # Parse date
            iso_date = ""
            if pub_date_str:
                try:
                    from email.utils import parsedate_to_datetime
                    dt = parsedate_to_datetime(pub_date_str)
                    iso_date = dt.isoformat()
                except Exception:
                    iso_date = pub_date_str

            items.append({
                "id": make_id(slug, title, link),
                "company_slug": slug,
                "company_name": company_name,
                "date_published": iso_date,
                "date_ingested": datetime.now(timezone.utc).isoformat(),
                "source_type": "news",
                "title": title,
                "url": link,
                "publisher": source,
                "summary_short": "",
                "image_url": None,
                "significance_score": 3,
                "sentiment": "neutral",
                "tags": [],
                "match_reason": "google_news_query_match",
            })
    except Exception as e:
        log(f"Google News search failed for '{query}': {e}", "warn")

    return items


# ---------------------------------------------------------------------------
# Crawl4ai-powered deep news search
# ---------------------------------------------------------------------------
async def search_news_crawl4ai(query: str, slug: str, company_name: str) -> list:
    """Use crawl4ai to scrape search results for deeper coverage."""
    try:
        from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig
    except ImportError:
        return []

    items = []
    search_url = f"https://www.google.com/search?q={quote_plus(query)}&tbm=nws&tbs=qdr:w"

    browser_cfg = BrowserConfig(headless=True, verbose=False)
    run_cfg = CrawlerRunConfig(wait_until="domcontentloaded")

    try:
        async with AsyncWebCrawler(config=browser_cfg) as crawler:
            result = await crawler.arun(url=search_url, config=run_cfg)
            if result.success and result.links:
                seen = set()
                for link_info in result.links.get("external", []):
                    href = link_info.get("href", "")
                    text = link_info.get("text", "").strip()
                    if not text or len(text) < 20 or href in seen:
                        continue
                    # Skip google/search engine links
                    domain = urlparse(href).netloc
                    if any(d in domain for d in ["google.", "gstatic.", "googleapis.", "youtube."]):
                        continue
                    seen.add(href)
                    items.append({
                        "id": make_id(slug, text, href),
                        "company_slug": slug,
                        "company_name": company_name,
                        "date_published": datetime.now(timezone.utc).isoformat(),
                        "date_ingested": datetime.now(timezone.utc).isoformat(),
                        "source_type": "news",
                        "title": text,
                        "url": href,
                        "publisher": domain,
                        "summary_short": "",
                        "image_url": None,
                        "significance_score": 2,
                        "sentiment": "neutral",
                        "tags": [],
                        "match_reason": "crawl4ai_search_result",
                    })
    except Exception as e:
        log(f"crawl4ai news search failed: {e}", "warn")

    return items[:MAX_NEWS_PER_COMPANY]


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------
def deduplicate(existing: list, new_items: list, key="url") -> list:
    """Merge new items into existing, deduplicating by URL."""
    existing_urls = {normalize_url(item.get(key, "")) for item in existing}
    added = []
    for item in new_items:
        norm = normalize_url(item.get(key, ""))
        if norm and norm not in existing_urls:
            existing_urls.add(norm)
            added.append(item)
    return added


def normalize_url(url: str) -> str:
    """Normalize URL for dedup comparison."""
    url = url.strip().rstrip("/")
    url = re.sub(r"[?#].*$", "", url)  # Strip query/fragment
    return url.lower()


# ---------------------------------------------------------------------------
# Main update logic
# ---------------------------------------------------------------------------
async def update_company(slug: str, company: dict, source: dict, dry_run=False,
                         skip_news=False, skip_blogs=False) -> dict:
    """Update a single company's data. Returns stats dict."""
    name = company.get("name", slug)
    website = source.get("website", company.get("domain", ""))
    query = source.get("query", f'"{name}"')
    rss_url = source.get("blog_rss")
    stats = {"blog_added": 0, "news_added": 0}

    log(f"{name} ({slug})", "head")

    # ---- Blog posts ----
    if not skip_blogs:
        blog_file = BLOG_DIR / f"{slug}.json"
        blog_data = load_json(blog_file, {
            "company_slug": slug,
            "source": website,
            "rss_url": rss_url or "",
            "last_fetched": "",
            "posts": [],
        })
        existing_posts = blog_data.get("posts", [])

        new_posts = []
        # Method 1: RSS feed
        if rss_url:
            log(f"Fetching RSS: {rss_url}")
            new_posts = fetch_rss_posts(rss_url, slug)

        # Method 2: Crawl website blog page
        if website and len(new_posts) < 3:
            log(f"Scraping website: {website}")
            scraped = await scrape_company_blog(website, slug, name)
            new_posts.extend(scraped)

        added = deduplicate(existing_posts, new_posts)
        if added:
            blog_data["posts"] = (added + existing_posts)[:MAX_BLOG_POSTS]
            blog_data["last_fetched"] = datetime.now(timezone.utc).isoformat()
            save_json(blog_file, blog_data, dry_run)
            stats["blog_added"] = len(added)
            log(f"Added {len(added)} new blog posts", "ok")
        else:
            log("No new blog posts found")

    # ---- News mentions ----
    if not skip_news:
        company_index_file = BY_COMPANY_DIR / f"{slug}.json"
        company_index = load_json(company_index_file, {
            "company_slug": slug,
            "items": [],
            "generated_at": "",
        })
        existing_news = company_index.get("items", [])

        new_news = []
        # Method 1: Google News RSS
        log(f"Searching Google News: {query}")
        new_news = fetch_google_news(query, slug, name)

        # Method 2: crawl4ai search (supplementary)
        if len(new_news) < 3:
            log("Trying crawl4ai deep search...")
            crawled_news = await search_news_crawl4ai(query, slug, name)
            new_news.extend(crawled_news)

        added_news = deduplicate(existing_news, new_news)
        if added_news:
            company_index["items"] = (added_news + existing_news)[:20]
            company_index["generated_at"] = datetime.now(timezone.utc).isoformat()
            save_json(company_index_file, company_index, dry_run)
            stats["news_added"] = len(added_news)
            log(f"Added {len(added_news)} news mentions", "ok")
        else:
            log("No new news mentions found")

    return stats


async def update_latest_validated(dry_run=False):
    """Rebuild latest-validated.json from all by-company index files."""
    log("Rebuilding latest-validated.json", "head")

    all_items = []
    for f in sorted(BY_COMPANY_DIR.glob("*.json")):
        data = load_json(f, {})
        items = data.get("items", [])
        all_items.extend(items)

    # Sort by date descending, take most recent
    def sort_key(item):
        d = item.get("date_published", "")
        return d if d else "0000"

    all_items.sort(key=sort_key, reverse=True)

    # Deduplicate by URL
    seen = set()
    unique = []
    for item in all_items:
        norm = normalize_url(item.get("url", ""))
        if norm not in seen:
            seen.add(norm)
            unique.append(item)

    validated = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "validation_applied": True,
        "matching_rules_version": "2.0",
        "items": unique[:200],
        "removed_false_positives": [],
    }
    save_json(LATEST_VALIDATED, validated, dry_run)
    log(f"Wrote {len(unique[:200])} validated items", "ok")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
async def main():
    parser = argparse.ArgumentParser(description="Blockwall Portfolio Weekly Updater")
    parser.add_argument("--company", type=str, help="Update a single company by slug")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing files")
    parser.add_argument("--news-only", action="store_true", help="Only fetch news, skip blogs")
    parser.add_argument("--blogs-only", action="store_true", help="Only fetch blogs, skip news")
    args = parser.parse_args()

    print("=" * 60)
    print("  Blockwall Portfolio - Weekly Company Updater")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 60)

    # Load configs
    companies_data = load_json(COMPANIES_JSON)
    sources = load_json(SOURCES_JSON, {})

    if not companies_data:
        log("Cannot load companies.json", "err")
        sys.exit(1)

    companies = {c["slug"]: c for c in companies_data.get("companies", [])}

    # Filter to single company if requested
    if args.company:
        if args.company not in companies:
            log(f"Unknown company slug: {args.company}", "err")
            log(f"Available: {', '.join(sorted(companies.keys()))}")
            sys.exit(1)
        slugs = [args.company]
    else:
        slugs = sorted(companies.keys())

    # Process companies
    total_stats = {"blog_added": 0, "news_added": 0, "companies": 0}
    for slug in slugs:
        company = companies[slug]
        source = sources.get(slug, {})
        stats = await update_company(
            slug, company, source,
            dry_run=args.dry_run,
            skip_news=args.blogs_only,
            skip_blogs=args.news_only,
        )
        total_stats["blog_added"] += stats["blog_added"]
        total_stats["news_added"] += stats["news_added"]
        total_stats["companies"] += 1

    # Rebuild aggregated index
    if not args.blogs_only:
        await update_latest_validated(dry_run=args.dry_run)

    # Summary
    print("\n" + "=" * 60)
    print("  SUMMARY")
    print("=" * 60)
    print(f"  Companies processed: {total_stats['companies']}")
    print(f"  New blog posts:      {total_stats['blog_added']}")
    print(f"  New news mentions:   {total_stats['news_added']}")
    if args.dry_run:
        print("  [DRY RUN - no files written]")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
