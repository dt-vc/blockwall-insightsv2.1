#!/usr/bin/env python3
"""Schema-validation CI for Blockwall Insights v2.

Validates every edition JSON under data/{daily,weekly,monthly}/ and every
manifest data/{daily,weekly,monthly}.json. Fails (exit 1) on: invalid JSON,
wrong/missing schema, missing core fields, id/type/filename mismatch, malformed
sections, a savable item missing its id, duplicate manifest ids, or a manifest
entry pointing to an edition file that doesn't exist (the class of bug that
produced /daily/undefined 404s). Pure stdlib — no dependencies.
"""
import json, os, sys, glob

errors, warnings = [], []
CADENCES = ["daily", "weekly", "monthly"]
# sections whose items are starrable by the curation layer -> each item needs an id
SAVABLE_FLAT = ("top_signals", "deals", "on_the_radar", "worth_a_read")
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

def validate_edition(path, cadence):
    d = load_json(path)
    if d is None:
        return
    if not isinstance(d, dict):
        err(f"{path}: edition must be a JSON object"); return
    if d.get("schema") != 2:
        err(f"{path}: schema must be 2 (got {d.get('schema')!r})")
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

    # flat savable sections: array of objects, each needs an id
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

    # what_to_watch: forward catalysts ({label,date,note}) — NOT savable, no id required
    wtw = d.get("what_to_watch")
    if wtw is not None:
        if not isinstance(wtw, list):
            err(f"{path}: 'what_to_watch' must be an array")
        else:
            for i, item in enumerate(wtw):
                if not isinstance(item, dict):
                    err(f"{path}: what_to_watch[{i}] must be an object")

    # all_resources: grouped; nested items ARE savable, so each needs an id
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

def validate_manifest(path, cadence, edition_ids):
    m = load_json(path)
    if m is None:
        return
    if not isinstance(m, list):
        err(f"{path}: manifest must be a JSON array"); return
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
    for eid in sorted(edition_ids - seen):
        warn(f"data/{cadence}/{eid}.json exists but is missing from {path}")

def main():
    any_data = False
    for cadence in CADENCES:
        paths = sorted(glob.glob(os.path.join("data", cadence, "*.json")))
        ids = set()
        for p in paths:
            validate_edition(p, cadence)
            ids.add(os.path.splitext(os.path.basename(p))[0])
        if paths:
            any_data = True
        mpath = os.path.join("data", f"{cadence}.json")
        if os.path.exists(mpath):
            validate_manifest(mpath, cadence, ids)
        elif paths:
            warn(f"editions exist for '{cadence}' but no manifest at {mpath}")
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