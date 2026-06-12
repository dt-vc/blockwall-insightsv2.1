#!/usr/bin/env python3
"""One-off migration: per-edition HTML archive -> v2 schema-2 edition JSON + manifests.

Covers all three cadences (daily/, weekly/, monthly/).

For each edition HTML file:
  - parse the rendered page (the live HTML is ground truth, not any workflow export)
  - emit data/<cadence>/<id>.json in the v2 edition shape (best-effort mapping;
    sections an edition never had are simply omitted and the renderer hides them)
  - rebuild data/<cadence>.json in the v2 manifest entry shape
    { id, type, date_display, title, sources, bullish, bearish, thumbnail, snippet }

Cadence mapping notes (the v2 contract is daily-edition.sample.json for ALL cadences):

DAILY   exec-summary bullets -> lead.tldr (joined " • "); stories -> top_signals;
        More to Watch -> on_the_radar (dot color -> sentiment); accordion -> all_resources.

WEEKLY  exec-summary bullets -> lead.tldr
        Market & On-chain Analytics -> market_snapshot (metric cards -> items;
          chart image / warning / per-metric interpretation kept as extra fields)
        Top Stories of the Week -> top_signals (why-matters -> why_it_matters;
          a single merged "STORY N:" blob from the backfill generator is split
          back onto its stories; sentiment pill -> sentiment; story date and
          "Also reported by" kept as extra fields)
        More Key Stories -> on_the_radar (image/date kept as extra fields)
        Notable Signals & Patterns -> worth_a_read (title+analysis pairs, or a
          merged numbered blob split into note-only items)
        per-category lists + "Also Worth Reading" -> all_resources

MONTHLY Month in Review -> lead.tldr
        Market & On-Chain Analytics -> market_snapshot
        Key Themes -> worth_a_read (title+analysis pairs, or merged blob split)
        Top Stories (Jan) / Strategic Developments deep-dives (Feb+) -> top_signals
          ("Impact: 11.88/10" -> significance, may exceed 10 — kept faithful)
        Portfolio Spotlight + Capital Flows story cards -> on_the_radar
          (category "Portfolio" / pill category; border color -> sentiment)
        Regulatory Developments -> all_resources "Regulation";
        Security & Incidents -> all_resources "Security" (taxonomy names so the
          renderer's category icons match)
        For Founders / For Investors -> worth_a_read (one annotated item per card)

Common:
  - items get stable synthesized ids: mig_<edition-id>_{s|r|a|w}<n>
  - "[Highlight] Sources" lists are skipped (renderer derives them from top_signals)
  - manifest entries already in the v2 shape (pipeline-written, e.g. daily
    2026-06-11) are preserved verbatim; so are existing data JSONs without
    mig_ ids (pipeline files are never overwritten)
  - data/daily/2026-06-09.json is the renderer acceptance fixture from the
    build brief, not published content: it gets no manifest entry
  - legacy manifest entries contribute title/thumbnail/snippet; counts come
    from the parsed page stats (legacy counts are zeroed for backfilled ranges)
  - newest first, deduped by id

Usage:
  python3 scripts/migrate_html_to_json.py [--repo PATH] [--cadence daily weekly monthly] [--dry-run]
"""

import argparse
import json
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup

SENTIMENT_BY_COLOR = {
    "#22c55e": "bullish",
    "#ef4444": "bearish",
    "#94a3b8": "neutral",
    "#166534": "bullish",   # pill backgrounds
    "#991b1b": "bearish",
}

STAT_KEY_BY_LABEL = {
    "sources": "sources",
    "stories analyzed": "sources",
    "key stories": "signals",
    "key developments": "signals",
    "highlights": "signals",
    "signals": "signals",
    "watching": "watching",
    "bullish": "bullish",
    "bullish signals": "bullish",
    "bearish": "bearish",
    "bearish signals": "bearish",
    "neutral": "neutral",
}

FIXTURE_IDS = {"2026-06-09"}

# the index pages' runtime fallback image; never a real per-edition thumbnail
GENERIC_THUMB_MARKER = "photo-1639762681057"

DATE_TOKEN_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SCORE_RE = re.compile(r"(?:score|impact):\s*([\d.]+)\s*/\s*10", re.I)


# ---------------------------------------------------------------- helpers

def text(node, default=""):
    if node is None:
        return default
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip()


def style_color(style, prop="color"):
    match = re.search(prop + r"\s*:\s*(#[0-9a-fA-F]{6})", style or "")
    return match.group(1).lower() if match else None


def dot_sentiment(container, default="neutral"):
    """Sentiment from a colored dot span (inline style color)."""
    if container is not None:
        for span in container.find_all("span"):
            color = style_color(span.get("style"))
            if color:
                return SENTIMENT_BY_COLOR.get(color, default)
    return default


def pull_pill_sentiment(node):
    """Find an inline sentiment pill span (background style), REMOVE it from the
    tree (its text otherwise bleeds into the meta line), return its sentiment."""
    if node is None:
        return None
    for span in node.find_all("span"):
        style = span.get("style") or ""
        if "background" in style:
            label = span.get_text(strip=True).lower()
            color = style_color(style, "background")
            span.decompose()
            if label in ("bullish", "bearish", "neutral"):
                return label
            if color in SENTIMENT_BY_COLOR:
                return SENTIMENT_BY_COLOR[color]
    return None


def split_meta(meta_text):
    """'DL News • DeFi • 2026-04-09 • Score: 10/10' ->
    {source, category, date, significance} (all optional)."""
    out = {"source": None, "category": None, "date": None, "significance": None}
    rest = []
    for part in (p.strip() for p in re.split(r"[•·]", meta_text)):
        if not part:
            continue
        m = SCORE_RE.search(part)
        if m:
            val = float(m.group(1))
            out["significance"] = int(val) if val.is_integer() else val
        elif DATE_TOKEN_RE.match(part):
            out["date"] = part
        else:
            rest.append(part)
    if rest:
        out["source"] = rest[0]
    if len(rest) > 1:
        out["category"] = rest[1]
    return out


def strip_label(raw):
    """Strip emoji prefix, trailing counts and '(N more stories)' from a heading."""
    label = re.sub(r"\(\s*\d+[^)]*\)\s*$", "", raw).strip()
    label = re.sub(r"\s*\d+\s*$", "", label).strip()
    label = re.sub(r"^[^\w(]+", "", label, flags=re.UNICODE).strip()
    return label or raw.strip()


def split_numbered(blob):
    """Split a merged 'Alpha ... 2. Beta ... 3. Gamma ...' blob from the backfill
    generator into chunks (leading 'N. ' markers stripped)."""
    parts = re.split(r"\s+(?=\d+\.\s+[A-Z“\"'])", blob)
    return [re.sub(r"^\d+\.\s+", "", p).strip() for p in parts if p.strip()]


def set_if(d, key, value):
    if value not in (None, "", [], {}):
        d[key] = value


# ---------------------------------------------------------------- shared parsers

def parse_stats(soup, edition_id, warnings):
    stats = {}
    for cell in soup.select(".newsletter-stat"):
        label = text(cell.select_one(".newsletter-stat-label")).lower()
        value = text(cell.select_one(".newsletter-stat-value"))
        key = STAT_KEY_BY_LABEL.get(label)
        if key is None:
            warnings.append(f"{edition_id}: unknown stat label {label!r}")
            continue
        try:
            stats[key] = int(value.replace(",", ""))
        except ValueError:
            warnings.append(f"{edition_id}: non-numeric stat {label!r}={value!r}")
    if not stats:
        warnings.append(f"{edition_id}: no stats parsed")
    return stats


def parse_story(story, item_id):
    """A .story block (daily/weekly/monthly-Jan top story) -> top_signal."""
    signal = {"id": item_id, "title": text(story.select_one(".story-title"))}
    sentiment = pull_pill_sentiment(story.select_one(".story-meta"))
    set_if(signal, "sentiment", sentiment)
    meta = split_meta(text(story.select_one(".story-meta")))
    set_if(signal, "source", meta["source"])
    set_if(signal, "category", meta["category"])
    set_if(signal, "date", meta["date"])
    if meta["significance"] is not None:
        signal["significance"] = meta["significance"]
    img = story.select_one("img.story-img, img.story-image")
    if img is not None and img.get("src"):
        signal["image_url"] = img["src"]
    set_if(signal, "summary", text(story.select_one(".story-summary")))
    link = story.select_one("a.story-link")
    if link is not None and link.get("href"):
        signal["url"] = link["href"]
    set_if(signal, "why_it_matters", text(story.select_one(".why-matters-text")))
    related = text(story.select_one(".related-sources"))
    set_if(signal, "related", related)
    return signal


def distribute_merged_why(signals, radar, edition_id, warnings):
    """Backfilled weeklies carry ONE why-matters blob on story 1 with 'STORY N:'
    markers, written for the full candidate set: chunks 1..len(signals) belong to
    the top stories and the rest continue (in order) onto the More Key Stories
    cards. Split it back onto the items it belongs to."""
    carriers = [s for s in signals if "why_it_matters" in s]
    if len(carriers) != 1 or "STORY 2:" not in carriers[0]["why_it_matters"]:
        return
    blob = carriers[0]["why_it_matters"]
    parts = re.split(r"STORY\s+(\d+):\s*", blob)
    chunks = {1: parts[0].strip()}
    for num, chunk in zip(parts[1::2], parts[2::2]):
        chunks[int(num)] = chunk.strip()
    if max(chunks) > len(signals) + len(radar):
        warnings.append(f"{edition_id}: merged why-matters references story "
                        f"{max(chunks)} of {len(signals)}+{len(radar)}; left merged")
        return
    del carriers[0]["why_it_matters"]
    for num, chunk in chunks.items():
        if not chunk:
            continue
        if num <= len(signals):
            signals[num - 1]["why_it_matters"] = chunk
        else:
            radar[num - len(signals) - 1]["why_it_matters"] = chunk


def parse_story_cards(grid, edition_id, prefix, start, default_category=None):
    """.story-card grid -> on_the_radar items (image/date kept as extra fields)."""
    items = []
    for i, card in enumerate(grid.select(".story-card"), start):
        link = card.select_one(".story-card-title a")
        if link is None:
            continue
        entry = {"id": f"mig_{edition_id}_{prefix}{i}", "title": text(link)}
        if link.get("href"):
            entry["url"] = link["href"]
        sentiment = pull_pill_sentiment(card.select_one(".story-card-meta"))
        if sentiment is None:
            color = style_color(card.get("style"), "border-left-color")
            sentiment = SENTIMENT_BY_COLOR.get(color) if color else None
        cat_pill = card.select_one(".story-card-cat")
        pill_category = text(cat_pill) if cat_pill else None
        meta = split_meta(text(card.select_one(".story-card-meta")))
        set_if(entry, "source", meta["source"])
        set_if(entry, "category", meta["category"] or pill_category or default_category)
        set_if(entry, "date", meta["date"])
        set_if(entry, "sentiment", sentiment)
        set_if(entry, "summary", text(card.select_one(".story-card-summary")))
        img = card.select_one("img.story-card-img")
        if img is not None and img.get("src"):
            entry["image_url"] = img["src"]
        items.append(entry)
    return items


def parse_other_list(section, edition_id, counter):
    """ul.other-list -> all_resources items. '(DL News, 2026-04-09)' -> source/date."""
    items = []
    for li in section.select("ul.other-list li"):
        link = li.find("a")
        if link is None:
            continue
        counter[0] += 1
        item = {"id": f"mig_{edition_id}_a{counter[0]}", "title": text(link)}
        if link.get("href"):
            item["url"] = link["href"]
        src = text(li.select_one(".other-source"))
        m = re.match(r"\(([^,)]+)(?:,\s*([^)]+))?\)", src)
        if m:
            item["source"] = m.group(1).strip()
            if m.group(2):
                item["date"] = m.group(2).strip()
        items.append(item)
    return items


def parse_metrics(section, edition_id, warnings):
    """analytics-section -> market_snapshot (chart/warning/interp kept as extras)."""
    items = []
    for card in section.select(".metric-card"):
        change_el = card.select_one(".metric-change")
        change = text(change_el)
        classes = set(change_el.get("class") or []) if change_el else set()
        direction = ("up" if classes & {"up", "positive"} else
                     "down" if classes & {"down", "negative"} else
                     "down" if change.startswith("▼") else "up")
        item = {"label": text(card.select_one(".metric-name")),
                "value": text(card.select_one(".metric-value"))}
        clean = re.sub(r"^[▲▼]\s*", "", change)
        set_if(item, "change_24h", clean)
        if clean:
            item["direction"] = direction
        set_if(item, "interpretation",
               text(card.select_one(".metric-interpretation, .metric-interp")))
        set_if(item, "metric_source", text(card.select_one(".metric-source")))
        items.append(item)
    if not items:
        warnings.append(f"{edition_id}: analytics section had no metric cards")
        return None
    snapshot = {"items": items}
    meta = text(section.select_one(".analytics-meta"))
    m = re.search(r"Data as of\s*(\d{4}-\d{2}-\d{2})", meta)
    if m:
        snapshot["as_of"] = m.group(1)
    m = re.search(r"Source:\s*(.+)$", meta)
    if m:
        snapshot["source"] = m.group(1).strip()
    if "source" not in snapshot:
        set_if(snapshot, "source", text(section.select_one(".analytics-subtitle")))
    chart = section.select_one(".analytics-chart img")
    if chart is not None and chart.get("src"):
        snapshot["chart_url"] = chart["src"]
    set_if(snapshot, "note", text(section.select_one(".analytics-warning")))
    return snapshot


def annotated_items(cards, title_sel, body_sel, edition_id, counter):
    """theme-cards / signal-items -> worth_a_read items. Title+analysis pairs map
    1:1; a merged numbered blob becomes note-only items."""
    items = []
    for card in cards:
        title = text(card.select_one(title_sel))
        body = text(card.select_one(body_sel)) if body_sel else ""
        counter[0] += 1
        if body:
            items.append({"id": f"mig_{edition_id}_w{counter[0]}",
                          "title": title, "note": body})
        else:
            chunks = split_numbered(title)
            if len(chunks) > 1:
                counter[0] -= 1
                for chunk in chunks:
                    counter[0] += 1
                    items.append({"id": f"mig_{edition_id}_w{counter[0]}", "note": chunk})
            else:
                items.append({"id": f"mig_{edition_id}_w{counter[0]}", "note": title})
    return items


# ---------------------------------------------------------------- cadence parsers

def parse_daily(soup, edition_id, warnings):
    edition = {"schema": 2, "type": "daily", "id": edition_id,
               "date_display": text(soup.select_one(".newsletter-date")) or edition_id}

    set_if(edition, "stats", parse_stats(soup, edition_id, warnings))

    exec_box = soup.select_one(".exec-summary")
    if exec_box is not None:
        bullets = [text(li) for li in exec_box.select("li") if text(li)]
        if bullets:
            edition["lead"] = {"tldr": " • ".join(bullets)}

    set_if(edition, "intro", text(soup.select_one(".newsletter-intro")))

    signals = [parse_story(s, f"mig_{edition_id}_s{i}")
               for i, s in enumerate(soup.select(".story"), 1)]
    signals = [s for s in signals if s["title"]]
    set_if(edition, "top_signals", signals)
    if not signals:
        warnings.append(f"{edition_id}: no stories parsed")

    radar = []
    for i, item in enumerate(soup.select(".watch-item"), 1):
        link = item.find("a")
        if link is None:
            continue
        entry = {"id": f"mig_{edition_id}_r{i}", "title": text(link),
                 "sentiment": dot_sentiment(item.select_one(".watch-meta"))}
        if link.get("href"):
            entry["url"] = link["href"]
        meta_text = text(item.select_one(".watch-meta")).lstrip("● ").strip()
        meta = split_meta(meta_text)
        set_if(entry, "source", (meta["source"] or "").lstrip("● ").strip())
        set_if(entry, "category", meta["category"])
        set_if(entry, "summary", text(item.select_one(".watch-summary")))
        radar.append(entry)
    set_if(edition, "on_the_radar", radar)

    groups = []
    counter = [0]
    for cat in soup.select(".res-category"):
        label = strip_label(text(cat.select_one(".res-cat-title")))
        items = []
        for card in cat.select("a.res-card"):
            counter[0] += 1
            item = {"id": f"mig_{edition_id}_a{counter[0]}",
                    "title": text(card.select_one(".res-card-title")),
                    "sentiment": dot_sentiment(card)}
            if card.get("href"):
                item["url"] = card["href"]
            set_if(item, "source", text(card.select_one(".res-card-source")))
            items.append(item)
        if items:
            groups.append({"category": label, "items": items})
    set_if(edition, "all_resources", groups)

    set_if(edition, "linkedin_post", text(soup.select_one(".linkedin-content")))
    return edition


def parse_weekly(soup, edition_id, warnings):
    week_num = int(edition_id.split("-W")[1])
    date_range = text(soup.select_one(".newsletter-date"))
    edition = {"schema": 2, "type": "weekly", "id": edition_id,
               "date_display": f"Week {week_num} · {date_range}" if date_range
               else f"Week {week_num}"}

    set_if(edition, "stats", parse_stats(soup, edition_id, warnings))

    exec_box = soup.select_one(".exec-summary")
    if exec_box is not None:
        bullets = [text(li) for li in exec_box.select("li") if text(li)]
        if bullets:
            edition["lead"] = {"tldr": " • ".join(bullets)}

    analytics = soup.select_one(".analytics-section")
    if analytics is not None:
        set_if(edition, "market_snapshot", parse_metrics(analytics, edition_id, warnings))

    signals = [parse_story(s, f"mig_{edition_id}_s{i}")
               for i, s in enumerate(soup.select(".story"), 1)]
    signals = [s for s in signals if s["title"]]
    if not signals:
        warnings.append(f"{edition_id}: no stories parsed")

    radar = []
    for grid in soup.select(".stories-grid"):
        radar.extend(parse_story_cards(grid, edition_id, "r", len(radar) + 1))
    distribute_merged_why(signals, radar, edition_id, warnings)
    set_if(edition, "top_signals", signals)
    set_if(edition, "on_the_radar", radar)

    wcounter = [0]
    set_if(edition, "worth_a_read",
           annotated_items(soup.select(".signal-item"), ".signal-title",
                           ".signal-analysis", edition_id, wcounter))

    groups = []
    counter = [0]
    for section in soup.select(".category-section"):
        label = strip_label(text(section.select_one(".category-title")))
        items = parse_other_list(section, edition_id, counter)
        if items:
            groups.append({"category": label, "items": items})
    secondary = soup.select_one(".secondary-section")
    if secondary is not None:
        items = parse_other_list(secondary, edition_id, counter)
        if items:
            groups.append({"category": strip_label(text(secondary.select_one(".secondary-title"))),
                           "items": items})
    set_if(edition, "all_resources", groups)

    set_if(edition, "linkedin_post", text(soup.select_one(".linkedin-content")))
    return edition


def parse_monthly(soup, edition_id, warnings):
    h1 = text(soup.select_one(".newsletter-header h1"))
    edition = {"schema": 2, "type": "monthly", "id": edition_id,
               "date_display": re.sub(r"\s*Insights\s*$", "", h1) or edition_id}

    set_if(edition, "stats", parse_stats(soup, edition_id, warnings))

    review = soup.select_one(".review-section")
    if review is not None:
        tldr = " ".join(text(p) for p in review.find_all("p") if text(p))
        if tldr:
            edition["lead"] = {"tldr": tldr}

    analytics = soup.select_one(".analytics-section")
    if analytics is not None:
        set_if(edition, "market_snapshot", parse_metrics(analytics, edition_id, warnings))

    # top_signals: Jan-era .story blocks and/or Feb+ deep-dive cards
    signals = [parse_story(s, f"mig_{edition_id}_s{i}")
               for i, s in enumerate(soup.select(".story"), 1)]
    signals = [s for s in signals if s["title"]]
    for i, card in enumerate(soup.select(".deep-dive-card"), len(signals) + 1):
        link = card.select_one("h3 a")
        if link is None:
            warnings.append(f"{edition_id}: deep-dive card {i} has no link; skipped")
            continue
        signal = {"id": f"mig_{edition_id}_s{i}", "title": text(link)}
        if link.get("href"):
            signal["url"] = link["href"]
        set_if(signal, "category", text(card.select_one(".deep-dive-category")))
        m = SCORE_RE.search(text(card.select_one(".deep-dive-score")))
        if m:
            val = float(m.group(1))
            signal["significance"] = int(val) if val.is_integer() else val
        meta = split_meta(text(card.select_one(".deep-dive-meta")))
        set_if(signal, "source", meta["source"])
        set_if(signal, "date", meta["date"])
        set_if(signal, "summary", text(card.select_one(".deep-dive-summary")))
        signals.append(signal)
    set_if(edition, "top_signals", signals)
    if not signals:
        warnings.append(f"{edition_id}: no stories parsed")

    # on_the_radar: Portfolio Spotlight + Capital Flows
    radar = []
    for item in soup.select(".portfolio-section .portfolio-item"):
        link = item.select_one("h4 a")
        if link is None:
            continue
        entry = {"id": f"mig_{edition_id}_r{len(radar) + 1}", "title": text(link),
                 "category": "Portfolio"}
        if link.get("href"):
            entry["url"] = link["href"]
        meta = split_meta(text(item.select_one(".portfolio-meta")))
        set_if(entry, "source", meta["source"])
        set_if(entry, "date", meta["date"])
        set_if(entry, "summary", " ".join(text(p) for p in item.find_all("p")))
        radar.append(entry)
    capital = soup.select_one(".capital-section")
    if capital is not None:
        radar.extend(parse_story_cards(capital, edition_id, "r", len(radar) + 1,
                                       default_category="Investment"))
    set_if(edition, "on_the_radar", radar)

    # worth_a_read: themes + For Founders / For Investors
    wcounter = [0]
    worth = annotated_items(soup.select(".theme-card"), ".theme-title",
                            ".theme-analysis", edition_id, wcounter)
    for card in soup.select(".insights-card"):
        title = strip_label(text(card.find("h3")))
        body = " ".join(text(el) for el in card.select(".insights-list, .insight-item p")
                        if text(el))
        if body:
            wcounter[0] += 1
            worth.append({"id": f"mig_{edition_id}_w{wcounter[0]}",
                          "title": title, "note": body})
    set_if(edition, "worth_a_read", worth)

    # all_resources: Regulatory Developments + Security & Incidents
    groups = []
    counter = [0]
    for sel, label in ((".reg-section", "Regulation"), (".sec-section", "Security")):
        section = soup.select_one(sel)
        if section is not None:
            items = parse_other_list(section, edition_id, counter)
            if items:
                groups.append({"category": label, "items": items})
    set_if(edition, "all_resources", groups)

    set_if(edition, "linkedin_post", text(soup.select_one(".linkedin-content")))
    return edition


# ---------------------------------------------------------------- manifest + main

CADENCES = {
    "daily": {
        "file_re": re.compile(r"blockwall-daily-(\d{4}-\d{2}-\d{2})\.html$"),
        "parse": parse_daily,
    },
    "weekly": {
        "file_re": re.compile(r"blockwall-weekly-(\d{4}-W\d{2})\.html$"),
        "parse": parse_weekly,
    },
    "monthly": {
        "file_re": re.compile(r"blockwall-monthly-(\d{4}-\d{2})\.html$"),
        "parse": parse_monthly,
    },
}


def manifest_entry(edition, legacy_entry):
    legacy_entry = legacy_entry or {}
    stats = edition.get("stats", {})
    signals = edition.get("top_signals", [])

    title = legacy_entry.get("title")
    if not title:
        title = ", ".join(s["title"] for s in signals)[:240]
    # a legacy thumbnail that is the site-wide generic fallback counts as absent;
    # prefer a real per-edition image from the page, else null (render-time fallback)
    thumbnail = legacy_entry.get("thumbnail")
    if thumbnail and GENERIC_THUMB_MARKER in thumbnail:
        thumbnail = None
    if not thumbnail:
        candidates = [s.get("image_url") for s in signals] + \
                     [r.get("image_url") for r in edition.get("on_the_radar", [])]
        thumbnail = next((c for c in candidates if c and GENERIC_THUMB_MARKER not in c), None)
    snippet = legacy_entry.get("snippet")
    if not snippet:
        snippet = (signals[0].get("summary", "")[:160] if signals else "")

    return {
        "id": edition["id"],
        "type": edition["type"],
        "date_display": edition["date_display"],
        "title": title or edition["date_display"],
        "sources": stats.get("sources", 0),
        "bullish": stats.get("bullish", 0),
        "bearish": stats.get("bearish", 0),
        "thumbnail": thumbnail,
        "snippet": snippet or "",
    }


def is_migrated_file(path):
    """True if an existing edition JSON was written by this script (mig_ ids)."""
    try:
        return '"mig_' in path.read_text(encoding="utf-8")
    except OSError:
        return False


def run_cadence(repo, cadence, dry_run):
    cfg = CADENCES[cadence]
    src_dir = repo / cadence
    out_dir = repo / "data" / cadence
    manifest_path = repo / "data" / f"{cadence}.json"

    legacy_by_id = {}
    v2_entries = {}
    if manifest_path.exists():
        for entry in json.loads(manifest_path.read_text(encoding="utf-8")):
            if "id" in entry and "type" in entry:          # already v2
                v2_entries[entry["id"]] = entry
            elif "filename" in entry or "date" in entry:   # legacy shapes
                m = cfg["file_re"].search(entry.get("filename", ""))
                key = m.group(1) if m else entry.get("date")
                if key:
                    legacy_by_id[key] = entry

    warnings = []
    editions = []
    skipped_pipeline = []
    for path in sorted(src_dir.glob("blockwall-*.html")):
        m = cfg["file_re"].search(path.name)
        if not m:
            warnings.append(f"skipped unrecognized file {path.name}")
            continue
        edition_id = m.group(1)
        out_path = out_dir / f"{edition_id}.json"
        if out_path.exists() and not is_migrated_file(out_path):
            skipped_pipeline.append(edition_id)
            warnings.append(f"{edition_id}: pipeline-written JSON exists; HTML not migrated")
            continue
        soup = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")
        editions.append(cfg["parse"](soup, edition_id, warnings))

    migrated_ids = {e["id"] for e in editions}
    for orphan in sorted(set(legacy_by_id) - migrated_ids):
        warnings.append(f"manifest entry {orphan} has no HTML file; dropped from manifest")

    merged = dict(v2_entries)   # pipeline + previously-migrated entries, verbatim
    for edition in editions:
        if edition["id"] in FIXTURE_IDS:
            continue
        merged.setdefault(edition["id"],
                          manifest_entry(edition, legacy_by_id.get(edition["id"])))
    manifest = sorted(merged.values(), key=lambda e: e["id"], reverse=True)

    print(f"[{cadence}] parsed {len(editions)} editions; manifest {len(manifest)} entries"
          f" ({len(skipped_pipeline)} pipeline-written preserved)")
    for warning in warnings:
        print(f"  WARN {warning}")

    if dry_run:
        return

    out_dir.mkdir(parents=True, exist_ok=True)
    for edition in editions:
        out = out_dir / f"{edition['id']}.json"
        out.write_text(json.dumps(edition, ensure_ascii=False, indent=2) + "\n",
                       encoding="utf-8")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                             encoding="utf-8")
    print(f"[{cadence}] wrote {len(editions)} edition files and data/{cadence}.json")


def main():
    parser = argparse.ArgumentParser(description="Migrate edition HTML archives to v2 JSON")
    parser.add_argument("--repo", default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument("--cadence", nargs="+", choices=list(CADENCES),
                        default=list(CADENCES))
    parser.add_argument("--dry-run", action="store_true", help="parse + report, write nothing")
    args = parser.parse_args()

    for cadence in args.cadence:
        run_cadence(Path(args.repo), cadence, args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
