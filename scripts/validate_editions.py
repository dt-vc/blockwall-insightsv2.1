#!/usr/bin/env python3
"""Schema-validation CI for Blockwall Insights v2.

Validates every edition JSON under data/{daily,weekly,monthly}/ and every
manifest data/{daily,weekly,monthly}.json. Fails (exit 1) on: invalid JSON,
wrong/missing schema, missing core fields, id/type/filename mismatch, malformed
sections, a savable item missing its id, a malformed market_snapshot, duplicate
manifest ids, a manifest entry pointing to a missing edition file (the class of
bug that produced /daily/undefined 404s), or a manifest stat that disagrees with
the edition it points at. Warns (does not fail) on softer drift: missing themes[]
on top_signals, non-http(s) urls, and a newer-than-supported schema_version.
Pure stdlib — no dependencies.
"""
import json, os, re, sys, glob

errors, warnings = [], []
CADENCES = ["daily", "weekly", "monthly"]
SUPPORTED_SCHEMA = 2
# sections whose items are starrable by the curation layer -> each item needs an id
SAVABLE_FLAT = ("top_signals", "deals", "on_the_radar", "worth_a_read")
URL_RE = re.compile(r"^https?://", re.I)
# aggregate themes-drift counters so we emit a single summary line per cadence
# instead of ~120 near-identical warnings
themes_missing = {c: [0, 0] for c in CADENCES}  # cadence -> [editions, items]
# editions whose top_signals ALL lack image_url -> signature of an upstream og:image
# scrape miss (e.g. the June 2026 window). Aggregated to one summary WARN per cadence;
# emitted as a GitHub Actions annotation so a silent regression becomes loud. NOT fatal
# (this validator gates the separately-owned data pipeline; a missing image is degraded
# gracefully by the renderer's branded tile, so it must not fail the build).
images_zero = {c: [] for c in CADENCES}  # cadence -> [edition_ids]

def err(m): errors.append(m)
def warn(m): warnings.append(m)

def load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        err(f"{path}: invalid JSON — {e}")
    except Exception as e:
        err(f"{path}: could not read — {e}")
    return None

def check_url_shape(path, where, item):
    """url is optional, but if present it must be http(s) — warn on shape only."""
    u = item.get("url")
    if u is not None and not (isinstance(u, str) and URL_RE.match(u)):
        warn(f"{path}: {where} url is not http(s) ({u!r})")

def validate_edition(path, cadence):
    """Returns the loaded edition dict (or None) so the manifest pass can reconcile."""
    d = load_json(path)
    if d is None:
        return None
    if not isinstance(d, dict):
        err(f"{path}: edition must be a JSON object"); return None

    # Version handshake: editions carry `schema` (integer) today; honor a future
    # `schema_version` too — schema_version ?? schema.
    declared = d.get("schema_version")
    if declared is None:
        declared = d.get("schema")
    if declared is None:
        err(f"{path}: missing 'schema'/'schema_version'")
    elif declared != SUPPORTED_SCHEMA:
        if isinstance(declared, (int, float)) and declared > SUPPORTED_SCHEMA:
            warn(f"{path}: declares schema {declared} newer than supported "
                 f"({SUPPORTED_SCHEMA}); the renderer will show an 'update needed' message")
        else:
            err(f"{path}: schema must be {SUPPORTED_SCHEMA} (got {declared!r})")

    for k in ("id", "type", "date_display"):
        if not d.get(k):
            err(f"{path}: missing required field '{k}'")
    if d.get("type") and d["type"] != cadence:
        err(f"{path}: type '{d['type']}' != folder '{cadence}'")
    fid = os.path.splitext(os.path.basename(path))[0]
    if d.get("id") and d["id"] != fid:
        err(f"{path}: id '{d['id']}' != filename '{fid}'")
    if d.get("lead") is not None and not isinstance(d["lead"], dict):
        err(f"{path}: 'lead' must be an object")

    # market_snapshot / tape: the renderer depends on items[].label + value
    ms = d.get("market_snapshot")
    if ms is not None:
        if not isinstance(ms, dict):
            err(f"{path}: 'market_snapshot' must be an object")
        elif ms.get("items") is not None:
            if not isinstance(ms["items"], list):
                err(f"{path}: market_snapshot.items must be an array")
            else:
                for i, it in enumerate(ms["items"]):
                    if not isinstance(it, dict):
                        err(f"{path}: market_snapshot.items[{i}] must be an object"); continue
                    if not it.get("label"):
                        warn(f"{path}: market_snapshot.items[{i}] missing 'label'")
                    if it.get("value") in (None, ""):
                        warn(f"{path}: market_snapshot.items[{i}] missing 'value'")

    # flat savable sections: array of objects, each needs an id (+ url shape)
    for sec in SAVABLE_FLAT:
        v = d.get(sec)
        if v is None:
            continue
        if not isinstance(v, list):
            err(f"{path}: section '{sec}' must be an array"); continue
        for i, item in enumerate(v):
            if not isinstance(item, dict):
                err(f"{path}: {sec}[{i}] must be an object")
            elif not item.get("id"):
                err(f"{path}: {sec}[{i}] missing 'id' (needed by the save layer)")
            else:
                check_url_shape(path, f"{sec}[{i}]", item)

    # top_signals should carry themes[] (brief §3, used for theme grouping in the
    # shortlist). Older migrated editions are §7 best-effort, so this is a WARN,
    # aggregated to one summary line per cadence rather than one per item.
    ts = d.get("top_signals")
    if isinstance(ts, list) and ts:
        missing = sum(1 for it in ts
                      if isinstance(it, dict) and not (isinstance(it.get("themes"), list) and it["themes"]))
        if missing:
            themes_missing[cadence][0] += 1
            themes_missing[cadence][1] += missing
        # image coverage: an edition whose top_signals ALL lack image_url signals an
        # upstream og:image scrape miss (the renderer then shows branded tiles for all).
        if sum(1 for it in ts if isinstance(it, dict) and it.get("image_url")) == 0:
            images_zero[cadence].append(os.path.splitext(os.path.basename(path))[0])

    # what_to_watch: forward catalysts ({label,date,note}) — NOT savable, no id required
    wtw = d.get("what_to_watch")
    if wtw is not None:
        if not isinstance(wtw, list):
            err(f"{path}: 'what_to_watch' must be an array")
        else:
            for i, item in enumerate(wtw):
                if not isinstance(item, dict):
                    err(f"{path}: what_to_watch[{i}] must be an object")

    # all_resources: grouped; nested items ARE savable, so each needs an id (+ url shape)
    ar = d.get("all_resources")
    if ar is not None:
        if not isinstance(ar, list):
            err(f"{path}: 'all_resources' must be an array")
        else:
            for i, grp in enumerate(ar):
                if not isinstance(grp, dict):
                    err(f"{path}: all_resources[{i}] must be an object"); continue
                items = grp.get("items")
                if items is None:
                    continue
                if not isinstance(items, list):
                    err(f"{path}: all_resources[{i}].items must be an array"); continue
                for j, it in enumerate(items):
                    if not isinstance(it, dict):
                        err(f"{path}: all_resources[{i}].items[{j}] must be an object")
                    elif not it.get("id"):
                        err(f"{path}: all_resources[{i}].items[{j}] missing 'id'")
                    else:
                        check_url_shape(path, f"all_resources[{i}].items[{j}]", it)
    return d

def validate_manifest(path, cadence, editions):
    """editions: {id: edition_dict} for referential + stat reconciliation."""
    m = load_json(path)
    if m is None:
        return
    if not isinstance(m, list):
        err(f"{path}: manifest must be a JSON array"); return
    edition_ids = set(editions)
    seen = set()
    for i, e in enumerate(m):
        if not isinstance(e, dict):
            err(f"{path}: entry[{i}] must be an object"); continue
        for k in ("id", "type", "date_display"):
            if not e.get(k):
                err(f"{path}: entry[{i}] missing '{k}'")
        eid = e.get("id")
        if not eid:
            continue
        if eid in seen:
            err(f"{path}: duplicate id '{eid}'")
        seen.add(eid)
        if e.get("type") and e["type"] != cadence:
            err(f"{path}: entry '{eid}' type '{e['type']}' != '{cadence}'")
        if eid not in edition_ids:
            err(f"{path}: entry '{eid}' has no edition file data/{cadence}/{eid}.json")
        if not e.get("title"):
            warn(f"{path}: entry '{eid}' has an empty title")
        for nk in ("sources", "bullish", "bearish"):
            if nk in e and not isinstance(e[nk], (int, float)):
                warn(f"{path}: entry '{eid}' field '{nk}' not a number ({e[nk]!r})")
        # reconcile numeric stats against the edition the entry points at; these
        # are derived from the edition so a mismatch means manifest/edition drift.
        # (title is intentionally NOT reconciled — card titles legitimately differ
        # from lead.headline / composed titles.)
        ed = editions.get(eid)
        if ed and isinstance(ed.get("stats"), dict):
            st = ed["stats"]
            for nk in ("sources", "bullish", "bearish"):
                if nk in e and nk in st and e[nk] != st[nk]:
                    warn(f"{path}: entry '{eid}' {nk}={e[nk]} disagrees with edition stats.{nk}={st[nk]}")
    for eid in sorted(edition_ids - seen):
        warn(f"data/{cadence}/{eid}.json exists but is missing from {path}")

def main():
    any_data = False
    for cadence in CADENCES:
        paths = sorted(glob.glob(os.path.join("data", cadence, "*.json")))
        editions = {}
        for p in paths:
            ed = validate_edition(p, cadence)
            eid = os.path.splitext(os.path.basename(p))[0]
            if ed is not None:
                editions[eid] = ed
            else:
                editions.setdefault(eid, {})
        if paths:
            any_data = True
        mpath = os.path.join("data", f"{cadence}.json")
        if os.path.exists(mpath):
            validate_manifest(mpath, cadence, editions)
        elif paths:
            warn(f"editions exist for '{cadence}' but no manifest at {mpath}")
        miss_ed, miss_items = themes_missing[cadence]
        if miss_ed:
            warn(f"{cadence}: {miss_ed} edition(s) have top_signals without themes[] "
                 f"({miss_items} items total) — brief §3 drift (older migrated editions are best-effort)")
        zero = images_zero[cadence]
        if zero:
            shown = ", ".join(zero[:12]) + (" …" if len(zero) > 12 else "")
            imsg = (f"{cadence}: {len(zero)} edition(s) have ZERO article images "
                    f"(all top_signals image_url null) — likely an upstream og:image scrape miss: {shown}")
            warn(imsg)
            print(f"::warning title=Image coverage::{imsg}")  # loud in GitHub Actions; non-fatal
        print(f"{cadence}: {len(paths)} edition(s) checked")
    if not any_data:
        err("no edition JSON found under data/* — is the checkout correct?")
    if warnings:
        print("\n--- warnings ---")
        for w in warnings: print("  ! " + w)
    if errors:
        print("\n--- errors ---")
        for e in errors: print("  x " + e)
        print(f"\nFAILED: {len(errors)} error(s)")
        sys.exit(1)
    print(f"\nOK: all editions and manifests valid ({len(warnings)} warning(s))")

if __name__ == "__main__":
    main()
