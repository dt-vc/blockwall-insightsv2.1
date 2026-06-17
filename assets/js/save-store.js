/* SaveStore — shared shortlist store backed by the LIVE n8n curation API.
   POST/DELETE  https://blockwall.app.n8n.cloud/webhook/bw-curate
   GET          https://blockwall.app.n8n.cloud/webhook/bw-curated   (empty body == [])
   Only the analyst NAME is persisted locally (localStorage 'bw-analyst').
   Rows are cached in memory and hydrated once via GET; the star UI stays
   synchronous (has/count read the cache) and re-syncs via subscribe() when the
   GET resolves or a save/remove mutates the cache (optimistic, with rollback).
   Live row shape:
     { edition_id, item_id, cadence, title, url, primary_source,
       category, theme, note, analyst, saved_at } */
(function (global) {
  "use strict";
  var WEBHOOK_BASE = "https://blockwall.app.n8n.cloud";
  var CURATE_URL = WEBHOOK_BASE + "/webhook/bw-curate";
  var CURATED_URL = WEBHOOK_BASE + "/webhook/bw-curated";
  var AKEY = "bw-analyst";

  var rows = null;        // null = not loaded yet; [] = loaded-empty
  var loadP = null;       // in-flight GET
  var curEd = null;       // current edition id (edition pages)
  var curCad = null;      // current cadence (daily/weekly/monthly)
  var subs = [];

  function notify() { subs.forEach(function (f) { try { f(rows || []); } catch (e) {} }); }
  function getAnalyst() { try { return (localStorage.getItem(AKEY) || "").trim(); } catch (e) { return ""; } }
  function setAnalyst(name) { try { localStorage.setItem(AKEY, (name || "").trim()); } catch (e) {} notify(); }
  function eq(a, b) { return String(a) === String(b); }
  function inferCadence(id) { id = id || ""; if (/-W\d/i.test(id)) return "weekly"; if (/^\d{4}-\d{2}-\d{2}/.test(id)) return "daily"; if (/^\d{4}-\d{2}$/.test(id)) return "monthly"; return "daily"; }

  function doGet() {
    return fetch(CURATED_URL).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    }).then(function (body) {
      if (!body) return [];                 // webhook returns EMPTY body (not []) when empty
      var a; try { a = JSON.parse(body); } catch (e) { return []; }
      return Array.isArray(a) ? a : [];
    });
  }
  function ensureLoaded() {
    if (rows) return Promise.resolve(rows);
    if (loadP) return loadP;
    loadP = doGet().then(function (a) { rows = a; notify(); return rows; },
      function (err) { loadP = null; rows = null; return []; });
    return loadP;
  }
  /* ensureLoaded() is lenient (edition pages degrade silently); refresh() is
     strict (the Saved view wants to distinguish "empty" from "API unreachable"). */
  function refresh() { rows = null; loadP = null; return doGet().then(function (a) { rows = a; notify(); return rows; }); }

  function post(row) {
    return fetch(CURATE_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(row) })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); });
  }
  function del(edId, itemId, analyst) {
    var qs = "?edition_id=" + encodeURIComponent(edId) + "&item_id=" + encodeURIComponent(itemId) + "&analyst=" + encodeURIComponent(analyst);
    return fetch(CURATE_URL + qs, { method: "DELETE" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); });
  }

  function mineHas(itemId) {
    var me = getAnalyst(); if (!rows || !me || curEd == null) return false;
    return rows.some(function (r) { return eq(r.edition_id, curEd) && eq(r.item_id, itemId) && r.analyst === me; });
  }

  var SaveStore = {
    /* lifecycle */
    setEdition: function (ed) { curEd = (ed && ed.id) || null; curCad = (ed && ed.type) || null; ensureLoaded().then(notify); },
    refresh: refresh,
    ensureLoaded: ensureLoaded,
    all: function () { return rows || []; },
    /* analyst */
    getAnalyst: getAnalyst,
    setAnalyst: setAnalyst,
    /* read (synchronous, cache-backed) */
    has: function (itemId) { return mineHas(itemId); },
    get: function (itemId) { var me = getAnalyst(); return (rows || []).filter(function (r) { return eq(r.item_id, itemId) && eq(r.edition_id, curEd) && r.analyst === me; })[0] || null; },
    count: function () { var me = getAnalyst(); return me ? (rows || []).filter(function (r) { return r.analyst === me; }).length : 0; },
    /* mutate */
    save: function (item) {
      var analyst = ((item.analyst || getAnalyst()) || "").trim();
      if (!analyst) return Promise.reject(new Error("analyst required"));
      setAnalyst(analyst);
      var edId = item.edition_id || curEd || null;
      var row = {
        edition_id: edId, item_id: item.id, cadence: curCad || inferCadence(edId),
        title: item.title || "", url: item.url || null, primary_source: item.source || null,
        category: item.category || null,
        theme: (item.theme || "").trim().toLowerCase() || (item.category || "").toLowerCase() || "untagged",
        note: (item.note || "").trim(), analyst: analyst, saved_at: new Date().toISOString()
      };
      if (!rows) rows = [];
      rows = rows.filter(function (r) { return !(eq(r.edition_id, row.edition_id) && eq(r.item_id, row.item_id) && r.analyst === row.analyst); });
      rows.unshift(row); notify();                       // optimistic
      return post(row).then(null, function (err) {        // rollback on failure (no re-throw)
        rows = rows.filter(function (r) { return r !== row; }); notify();
        if (global.console) console.warn("[SaveStore] save failed:", err && err.message);
      });
    },
    toggle: function (item) { if (mineHas(item.id)) { SaveStore.remove(item.id); return false; } SaveStore.save(item); return true; },
    remove: function (itemId) { return SaveStore.removeRow(curEd, itemId, getAnalyst()); },
    removeRow: function (edId, itemId, analyst) {
      if (rows) { rows = rows.filter(function (r) { return !(eq(r.edition_id, edId) && eq(r.item_id, itemId) && r.analyst === analyst); }); notify(); }
      return del(edId, itemId, analyst).then(null, function (err) { refresh(); if (global.console) console.warn("[SaveStore] remove failed:", err && err.message); });
    },
    subscribe: function (fn) { subs.push(fn); return function () { subs = subs.filter(function (f) { return f !== fn; }); }; }
  };

  global.addEventListener("storage", function (e) { if (e.key === AKEY) notify(); });
  global.SaveStore = SaveStore;
})(window);
