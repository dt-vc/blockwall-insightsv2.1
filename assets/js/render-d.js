/* Blockwall — "Signal Desk" edition renderer (final). XSS-safe. */
(function () {
  "use strict";
  var CFG = window.BW_CONFIG || {};
  document.documentElement.classList.add("dir-d");
  document.documentElement.setAttribute("data-direction", "d");
  var Store = window.SaveStore;
  var _ed = null, _man = [], _nav = null;

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) { var v = attrs[k]; if (v == null || v === false) continue;
      if (k === "class") el.className = v; else if (k === "html") el.innerHTML = v; else if (k === "style") el.setAttribute("style", v);
      else if (k in el && k !== "list") { try { el[k] = v; } catch (e) { el.setAttribute(k, v); } } else el.setAttribute(k, v); }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]); return el;
  }
  function add(el, c) { if (c == null || c === false) return; if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; } el.appendChild(c.nodeType ? c : document.createTextNode(String(c))); }
  function safeUrl(u) { return (typeof u === "string" && /^https?:\/\//i.test(u)) ? u : null; }
  function initial(s) { return (String(s || "?").trim()[0] || "?").toUpperCase(); }
  function monogram(s) { s = String(s || "").trim(); if (!s) return "BW"; var p = s.split(/[\s._\/-]+/).filter(Boolean); if (p.length >= 2) return (p[0].charAt(0) + p[1].charAt(0)).toUpperCase(); return (s.replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || "BW").toUpperCase(); }
  /* Self-contained branded fallback tile (no external image/logo/favicon service). */
  function brandTile(source, label) { var el = h("div", { class: "fallback-cover" }, h("span", { class: "fallback-cover__mono" }, monogram(source))); if (label) el.appendChild(h("span", { class: "fallback-cover__lbl" }, String(label))); return el; }
  /* imgFor: real og:image (item.image_url) only — the pipeline now fills it; no dead assets.images. Null => branded tile. */
  function imgFor(item) { if (!item) return null; var u = safeUrl(item.image_url); return u ? { img: u, real: true, link: item.url } : null; }
  var ICON = {
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3.5l2.6 5.55 6.02.78-4.45 4.16 1.16 5.96L12 17.9l-5.33 2.71 1.16-5.96L3.38 9.83l6.02-.78L12 3.5z"/></svg>',
    starF: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.5l2.6 5.55 6.02.78-4.45 4.16 1.16 5.96L12 17.9l-5.33 2.71 1.16-5.96L3.38 9.83l6.02-.78L12 3.5z"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 6l6 6-6 6"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 15l6-6"/><path d="M11 6l1-1a4 4 0 0 1 6 6l-1 1"/><path d="M13 18l-1 1a4 4 0 0 1-6-6l1-1"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12l4 4 10-10"/></svg>'
  };
  var SENT = { bullish: "▲", bearish: "▼", neutral: "–" };
  function fmtDate(id) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(id || ""); return m ? m[2] + "." + m[3] + "." + m[1].slice(2) : (id || ""); }
  function sentChip(s) { return s ? h("span", { class: "sent " + s }, (SENT[s] || "–") + " " + s.charAt(0).toUpperCase() + s.slice(1)) : null; }

  /* ---------- premium feature helpers ---------- */
  function brushDash() {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 120 34"); s.setAttribute("class", "brush-dash"); s.setAttribute("aria-hidden", "true"); s.setAttribute("focusable", "false");
    s.innerHTML = '<path fill="currentColor" d="M3 22 C 26 13, 52 11, 78 13 C 95 14, 108 16, 117 13 C 110 17, 96 20, 79 20 C 53 21, 27 22, 5 27 C 3.6 27.3 2.4 26.6 2.2 25.2 C 2 24 2 23 3 22 Z"/>';
    return s;
  }
  function readingTime(ed) {
    var t = [ed.lead && ed.lead.headline, ed.lead && ed.lead.tldr, ed.intro];
    (ed.top_signals || []).forEach(function (s) { t.push(s.title, s.why_it_matters, s.summary); });
    (ed.deals || []).forEach(function (d) { t.push(d.summary); });
    (ed.on_the_radar || []).concat(ed.worth_a_read || []).forEach(function (r) { t.push(r.title, r.note); });
    var w = t.join(" ").trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(w / 225));
  }
  function deskByline() {
    return h("p", { class: "desk-byline" }, h("span", { class: "desk-dot", "aria-hidden": "true" }),
      "Blockwall Signal Desk", h("span", { class: "desk-sep", "aria-hidden": "true" }, "·"), "Frankfurt");
  }
  function credRow(s, isTop) {
    var chips = [];
    if (isTop) chips.push(h("span", { class: "cred-chip cred-top" }, "Top signal"));
    if (s.source_domain) chips.push(h("span", { class: "cred-chip cred-domain num" }, s.source_domain));
    (s.themes || []).slice(0, 2).forEach(function (t) { chips.push(h("span", { class: "cred-chip cred-theme" }, String(t))); });
    return chips.length ? h("div", { class: "signal__cred" }, chips) : null;
  }
  function pickPullQuote(ed) {
    var arr = ed.top_signals || [], cand = null;
    for (var i = 0; i < Math.min(3, arr.length); i++) {
      var w = (arr[i].why_it_matters || "").trim();
      if (w && (!cand || w.length > cand.text.length)) cand = { text: firstSentences(w, 180), src: arr[i].source };
    }
    return cand;
  }
  function pullQuote(ed) {
    var q = pickPullQuote(ed); if (!q) return null;
    return h("figure", { class: "pullquote reveal" }, h("div", { class: "pullquote__mark" }, brushDash()),
      h("blockquote", { "aria-hidden": "true" }, h("p", null, q.text)),
      h("figcaption", { class: "pullquote__by" }, "Blockwall Signal Desk", q.src ? h("span", { class: "pullquote__src" }, " · on " + q.src) : null));
  }
  function ednavLink(entry, dir) {
    var kicker = dir === "prev" ? "Older edition" : "Newer edition";
    if (!entry) return h("span", { class: "ednav__link is-disabled ednav--" + dir, "aria-disabled": "true" },
      h("span", { class: "ednav__meta" }, h("span", { class: "ednav__kicker" }, kicker), h("span", { class: "ednav__title" }, "—")));
    var arrow = h("span", { class: "ednav__arrow", html: ICON.chev });
    var meta = h("span", { class: "ednav__meta" }, h("span", { class: "ednav__kicker" }, kicker),
      h("span", { class: "ednav__date num" }, entry.date_display || fmtDate(entry.id)),
      h("span", { class: "ednav__title" }, firstSentences(entry.title || entry.id, 72)));
    return h("a", { class: "ednav__link ednav--" + dir, rel: dir, href: location.pathname + "?id=" + encodeURIComponent(entry.id),
      "aria-label": kicker + ": " + (entry.title || entry.id) }, dir === "prev" ? [arrow, meta] : [meta, arrow]);
  }
  function editionNav(nav) {
    if (!nav || (!nav.older && !nav.newer)) return null;
    return h("nav", { class: "ednav", "aria-label": "Edition navigation" }, ednavLink(nav.older, "prev"), ednavLink(nav.newer, "next"));
  }
  /* share / copy-permalink */
  function legacyCopy(t) { var a = document.createElement("textarea"); a.value = t; a.style.cssText = "position:fixed;left:-9999px"; document.body.appendChild(a); a.select(); try { document.execCommand("copy"); } catch (e) {} document.body.removeChild(a); }
  function toast(msg) { var l = document.getElementById("bw-toast"); if (!l) return; l.textContent = msg; l.classList.add("is-on"); clearTimeout(l.__t); l.__t = setTimeout(function () { l.classList.remove("is-on"); }, 1800); }
  function flashCopied(btn) { if (!btn) return; btn.classList.add("is-copied"); var t = btn.querySelector(".hero__share-txt"); var o = t && t.textContent; if (t) t.textContent = "Copied"; setTimeout(function () { btn.classList.remove("is-copied"); if (t) t.textContent = o; }, 1600); }
  function copyToClipboard(text, btn, msg) {
    var done = function () { flashCopied(btn); toast(msg || "Link copied"); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done).catch(function () { legacyCopy(text); done(); });
    else { legacyCopy(text); done(); }
  }
  function shareOrCopy(url, title, btn) {
    if (navigator.share) navigator.share({ title: title, url: url }).catch(function (e) { if (e && e.name !== "AbortError") copyToClipboard(url, btn); });
    else copyToClipboard(url, btn);
  }

  function closeCuratePanel() { var p = document.querySelector(".curate-panel"); if (p) { if (p.__outside) document.removeEventListener("click", p.__outside, true); p.remove(); } }
  function openCuratePanel(starEl, item, onDone) {
    closeCuratePanel();
    var analyst = Store.getAnalyst();
    var panel = h("div", { class: "curate-panel", role: "dialog", "aria-label": "Save to shortlist" });
    var note = h("input", { class: "curate-input", type: "text", placeholder: "One-line note (optional)", maxlength: "140", "aria-label": "Note" });
    var theme = h("input", { class: "curate-input", type: "text", placeholder: "theme", value: (item.category || "").toLowerCase(), maxlength: "32", "aria-label": "Theme" });
    var analystInput = h("input", { class: "curate-input curate-analyst", type: "text", placeholder: "Your name (analyst)", value: analyst || "", maxlength: "24", "aria-label": "Analyst name" });
    var analystLine = analyst ? h("div", { class: "curate-analyst-line" }, h("span", { class: "muted" }, "Analyst · "), h("b", null, analyst), h("button", { class: "curate-change", type: "button" }, "change")) : null;
    var save = h("button", { class: "curate-save", type: "button" }, "Save");
    var cancel = h("button", { class: "curate-cancel", type: "button" }, "Cancel");
    panel.appendChild(h("div", { class: "curate-panel__head" }, "★ Save to shortlist"));
    panel.appendChild(analyst ? analystLine : analystInput);
    panel.appendChild(note); panel.appendChild(theme);
    panel.appendChild(h("div", { class: "curate-panel__actions" }, save, cancel));
    document.body.appendChild(panel);
    var r = starEl.getBoundingClientRect(); var pw = 264;
    panel.style.left = Math.max(12, Math.min(r.right - pw, window.innerWidth - pw - 12)) + "px";
    panel.style.top = (Math.min(r.bottom + 8, window.innerHeight - 220)) + "px";
    if (analystLine) analystLine.querySelector(".curate-change").addEventListener("click", function () { panel.replaceChild(analystInput, analystLine); analystInput.focus(); });
    (analyst ? note : analystInput).focus();
    function doSave() {
      var who = (panel.contains(analystInput) ? analystInput.value.trim() : analyst) || "";
      if (!who) { panel.replaceChild(analystInput, panel.querySelector(".curate-analyst-line") || analystInput); analystInput.classList.add("curate-input--err"); analystInput.focus(); return; }
      Store.setAnalyst(who);
      Store.save({ id: item.id, title: item.title, url: item.url, source: item.source, edition_id: item.edition_id, type: item.type, category: item.category, analyst: who, note: note.value, theme: theme.value });
      closeCuratePanel(); onDone();
    }
    save.addEventListener("click", doSave); cancel.addEventListener("click", closeCuratePanel);
    [note, theme, analystInput].forEach(function (i) { i.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); doSave(); } else if (e.key === "Escape") closeCuratePanel(); }); });
    panel.__outside = function (e) { if (!panel.contains(e.target) && e.target !== starEl) closeCuratePanel(); };
    setTimeout(function () { document.addEventListener("click", panel.__outside, true); }, 0);
  }
  function saveStar(item) {
    var saved = Store && item.id ? Store.has(item.id) : false;
    var b = h("button", { class: "star", type: "button", "aria-pressed": saved ? "true" : "false", "aria-label": "Save to shortlist", html: saved ? ICON.starF : ICON.star });
    b.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation(); if (!Store || !item.id) return;
      if (b.getAttribute("aria-pressed") === "true") { Store.remove(item.id); b.setAttribute("aria-pressed", "false"); b.innerHTML = ICON.star; }
      else openCuratePanel(b, item, function () { b.setAttribute("aria-pressed", "true"); b.innerHTML = ICON.starF; });
    });
    return b;
  }
  function syncBadge() { var el = document.getElementById("saved-count"); if (el && Store) { var c = Store.count(); el.textContent = String(c); el.style.display = c ? "" : "none"; } }
  function refreshStars() {
    if (!Store) return;
    document.querySelectorAll("[data-item-id]").forEach(function (host) {
      var id = host.getAttribute("data-item-id"); if (!id) return;
      var star = host.querySelector(".star"); if (!star) return;
      var on = Store.has(id); star.setAttribute("aria-pressed", on ? "true" : "false"); star.innerHTML = on ? ICON.starF : ICON.star;
    });
  }

  /* image block for signal cards */
  function imageBlock(rec, source, sizeCls, asAnchor) {
    var cls = "img-glass" + (sizeCls ? " " + sizeCls : "");
    var inner;
    if (rec && rec.img) { inner = h("img", { src: rec.img, alt: "", loading: "lazy", decoding: "async" });
      inner.addEventListener("error", function () { var p = inner.parentNode; if (p) { inner.remove(); p.appendChild(brandTile(source, source)); } }); }
    else inner = brandTile(source, source);
    var url = rec && safeUrl(rec.link);
    if (rec && rec.img && asAnchor && url) return h("a", { class: cls, href: url, target: "_blank", rel: "noopener", "aria-hidden": "true", tabindex: "-1" }, inner);
    return h("div", { class: cls }, inner);
  }

  /* ---------- masthead + live tape ---------- */
  function masthead(ed, no) {
    var cad = ed.type || "daily", Cad = cad.charAt(0).toUpperCase() + cad.slice(1);
    function seg(n) { return h("a", { href: n === "Daily" ? "daily.html" : n === "Weekly" ? "weekly.html" : n === "Monthly" ? "monthly.html" : "portfolio/index.html", "aria-current": n.toLowerCase() === cad ? "page" : null }, n); }
    return h("header", { class: "masthead", id: "masthead" },
      h("div", { class: "wrap masthead-inner" },
        h("a", { class: "wordmark", href: "index.html", style: "color:inherit" }, window.BWBrand ? window.BWBrand.mark() : "Blockwall"),
        h("nav", { class: "cadence-switch", "aria-label": "Cadence" }, seg("Daily"), seg("Weekly"), seg("Monthly"), seg("Portfolio")),
        h("span", { class: "nav-spacer" }),
        h("span", { class: "dateline eyebrow num" }, Cad + (no ? " · No. " + no : "") + " · " + (ed.date_display || fmtDate(ed.id))),
        h("div", { class: "nav-actions" }, h("a", { href: "index.html" }, "Home"), h("a", { href: "archive.html" }, "Archive"),
          h("a", { href: "saved.html" }, "Saved", h("span", { class: "count-badge", id: "saved-count" }, "0")),
          h("button", { class: "icon-btn", "aria-label": "Theme", html: ICON.moon }))),
      h("div", { class: "wrap" }, h("nav", { class: "subnav", "aria-label": "Sections" },
        h("a", { href: "#hero" }, "Lead"), h("a", { href: "#tape" }, "The Tape"), h("a", { href: "#signals" }, "Signals"), h("a", { href: "#deals" }, "Deals"), h("a", { href: "#rail" }, "Radar"))));
  }

  function liveTape(ed) {
    var ms = ed.market_snapshot; if (!ms || !ms.items) return null;
    var win = ed.type === "weekly" ? "7d" : ed.type === "monthly" ? "30d" : "24h";
    function cell(it) {
      var raw = it.change_24h == null ? "" : String(it.change_24h), numeric = /[0-9]/.test(raw);
      var dir = numeric ? (it.direction || (/^-/.test(raw) ? "down" : "up")) : "flat", g = dir === "up" ? "▲" : dir === "down" ? "▼" : "–";
      return h("span", { class: "lt-cell" }, h("span", { class: "lt-dot" }), h("span", { class: "lt-label" }, it.label), h("span", { class: "lt-price num" }, it.value == null ? "—" : it.value), h("span", { class: "lt-delta " + dir + " num" }, g + " " + (numeric ? raw : "N/A")));
    }
    var set = ms.items.map(cell), set2 = ms.items.map(cell);
    return h("section", { class: "livetape", "aria-label": "Live market tape" }, h("div", { class: "livetape-track" }, set, set2));
  }

  /* ---------- hero + signal index ---------- */
  function firstSentences(t, max) { t = String(t || "").trim(); if (t.length <= max) return t; var cut = t.slice(0, max); var d = cut.lastIndexOf(". "); return d > 80 ? cut.slice(0, d + 1) : cut.replace(/\s+\S*$/, "") + "…"; }
  function hero(ed, no, heroImg) {
    var L = ed.lead || {}, cad = ed.type || "daily", Cad = cad.charAt(0).toUpperCase() + cad.slice(1);
    var headline = L.headline || (cad === "monthly" ? "The month in crypto" + (ed.date_display ? " · " + ed.date_display : "") : cad === "weekly" ? "The week in crypto" : "Today's signal");
    var stand = firstSentences(L.tldr, 280);
    var bg = heroImg ? h("div", { class: "hero__bg", style: "background-image:url('" + heroImg + "')" }) : h("div", { class: "hero__bg is-fallback" });
    /* hero bg is a CSS background-image (no onerror) — probe it and degrade to the branded
       fallback gradient if the (hotlinked) image is dead, matching the signal cards. */
    if (heroImg) { var heroProbe = new Image(); heroProbe.onerror = function () { bg.className = "hero__bg is-fallback"; bg.removeAttribute("style"); }; heroProbe.src = heroImg; }
    var shareBtn = h("button", { class: "hero__share", type: "button", "aria-label": "Copy link to this edition" },
      h("span", { class: "hero__share-ico", "aria-hidden": "true", html: ICON.link }), h("span", { class: "hero__share-txt" }, "Copy link"));
    return h("section", { class: "hero reveal", id: "hero" }, bg, h("div", { class: "hero__scrim" }),
      h("div", { class: "hero__card" },
        h("div", { class: "hero__eyebrow eyebrow" }, h("span", { class: "chip accent" }, Cad), no ? h("span", { class: "num" }, "No. " + no) : null,
          h("span", { class: "num" }, ed.date_display || fmtDate(ed.id)), h("span", { class: "read-time num" }, "~" + readingTime(ed) + " min read"), shareBtn),
        deskByline(),
        h("div", { class: "hero__rule" }, brushDash()),
        h("h1", { class: "hero__title" }, headline),
        stand ? h("p", { class: "hero__tldr" }, stand) : null));
  }

  function statsBlock(ed) {
    var s = ed.stats; if (!s) return null;
    var tot = (s.bullish || 0) + (s.bearish || 0) + (s.neutral || 0);
    var idx = tot ? Math.round(100 * ((s.bullish || 0) + 0.5 * (s.neutral || 0)) / tot) : null;
    var label = idx == null ? "" : idx < 28 ? "Fear" : idx < 45 ? "Cautious" : idx <= 55 ? "Neutral" : idx <= 72 ? "Risk-on" : "Greed";
    var len = Math.PI * 64;
    var svg = '<svg viewBox="0 0 156 96" class="sigx-svg" aria-hidden="true"><defs><linearGradient id="sigxg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="var(--down)"/><stop offset="0.5" stop-color="var(--flat)"/><stop offset="1" stop-color="var(--up)"/></linearGradient></defs>'
      + '<path d="M14 82 A64 64 0 0 1 142 82" fill="none" stroke="var(--border-strong)" stroke-width="9" stroke-linecap="round"/>'
      + '<path class="sigx-fill" d="M14 82 A64 64 0 0 1 142 82" fill="none" stroke="url(#sigxg)" stroke-width="9" stroke-linecap="round" stroke-dasharray="' + len + '" stroke-dashoffset="' + len + '" data-off="' + (len * (1 - (idx || 0) / 100)) + '"/></svg>';
    function cell(l, n, k) { return (n == null) ? null : h("div", { class: "stat " + (k || "") }, h("span", { class: "n num" }, String(n)), h("span", { class: "eyebrow" }, l)); }
    var infoBtn = h("button", { class: "sigx-info", type: "button", "aria-expanded": "false", "aria-controls": "sigx-method", "aria-describedby": "sigx-method", "aria-label": "How the Signal Index is calculated",
      html: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 7v4M8 4.6v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' });
    var methodPanel = h("div", { id: "sigx-method", class: "sigx-method", role: "tooltip", hidden: "hidden" },
      h("p", null, "A curated read of this edition's sentiment — not a market price index."),
      h("p", { class: "sigx-method__f" }, "Index = 100 × (bullish + ½·neutral) ÷ total signals."),
      h("ul", { class: "sigx-method__bands" },
        [["Fear", "0–27"], ["Cautious", "28–44"], ["Neutral", "45–55"], ["Risk-on", "56–72"], ["Greed", "73–100"]].map(function (b) { return h("li", null, h("b", null, b[0]), " " + b[1]); })),
      h("p", { class: "sigx-method__note" }, "Counts are analyst-curated, not algorithmic. Sentiment, not advice."));
    var trend = (_man || []).slice(0, 14).reverse().map(function (e) { var tt = (e.bullish || 0) + (e.bearish || 0); return tt ? Math.round(100 * (e.bullish || 0) / tt) : 50; });
    var sparkEl = (trend.length > 2 && window.BWSpark) ? h("div", { class: "sigx-spark", html: window.BWSpark.svg(trend, { w: 120, h: 28, min: 0, max: 100, baseline: 50, label: "Signal Index trend, last " + trend.length + " editions, now " + idx + " of 100" }) }) : null;
    var gauge = idx == null ? null : h("div", { class: "sigx" },
      h("div", { class: "sigx-gauge", html: svg }, h("div", { class: "sigx-read" }, h("span", { class: "sigx-num num" }, String(idx)), h("span", { class: "sigx-label" }, label))),
      h("div", { class: "sigx-meta" }, h("span", { class: "eyebrow sigx-eyebrow" }, "Signal Index", infoBtn),
        h("p", { class: "t-small secondary" }, "Edition mood — " + (s.bullish || 0) + " bullish · " + (s.bearish || 0) + " bearish · " + (s.neutral || 0) + " neutral."),
        sparkEl, methodPanel));
    return h("section", { class: "blk reveal statsblk" }, h("div", { class: "wrap statsblk-row" }, gauge,
      h("div", { class: "stats" }, cell("Sources", s.sources), cell("Signals", s.signals), cell("Watching", s.watching), cell("Bullish", s.bullish, "up"), cell("Bearish", s.bearish, "down"), cell("Neutral", s.neutral))));
  }

  function blk(id, num, title, body, cls) {
    return h("section", { class: "blk reveal " + (cls || ""), id: id },
      (num || title) ? h("div", { class: "blk-head" }, num ? h("span", { class: "blk-num num" }, num) : null, title ? h("h2", { class: "blk-title" }, title) : null) : null, body);
  }

  function tape(ed) {
    var ms = ed.market_snapshot; if (!ms || !ms.items) return null;
    var win = ed.type === "weekly" ? "7d" : ed.type === "monthly" ? "30d" : "24h";
    var annotated = ms.items.some(function (i) { return i.interpretation; });
    var cells = ms.items.map(function (it) {
      var raw = it.change_24h == null ? "" : String(it.change_24h), numeric = /[0-9]/.test(raw);
      var dir = numeric ? (it.direction || (/^-/.test(raw) ? "down" : "up")) : "flat", g = dir === "up" ? "▲" : dir === "down" ? "▼" : "–";
      return h("div", { class: "tape-cell", role: "group", "aria-label": it.label + " " + (it.value || "n/a") },
        h("span", { class: "tape-label eyebrow" }, it.label), h("span", { class: "tape-price num" }, it.value == null ? "—" : it.value),
        h("div", null, h("span", { class: "delta " + dir }, h("span", { class: "g" }, g), numeric ? raw : "N/A", h("span", { class: "win" }, win))),
        it.interpretation ? h("p", { class: "tape-interp t-small secondary" }, it.interpretation) : null);
    });
    var srcline;
    if (annotated) { var srcs = {}; ms.items.forEach(function (i) { if (i.metric_source) srcs[i.metric_source] = 1; }); var k = Object.keys(srcs); srcline = "Source: " + (k.length ? k.join(", ") : (ms.source || "—")); }
    else srcline = "Source: " + (ms.source || "—");
    return blk("tape", "01", "The Tape", h("div", null, h("div", { class: "tape" + (annotated ? " tape--annotated" : ""), "aria-live": "polite", "aria-atomic": "true" }, cells), h("p", { class: "tape-asof t-caption num", "aria-hidden": "true" }, srcline)));
  }

  /* ---------- signals ---------- */
  function signalCard(s, assets, featured, edId, isTop) {
    var rec = imgFor(s, assets), url = safeUrl(s.url);
    var shareBtn = h("button", { class: "signal__share", type: "button", "aria-label": "Copy link to this signal", html: ICON.link }, h("span", { class: "sr-only" }, "Copy link to: " + (s.title || "")));
    return h("article", { class: "signal reveal" + (featured ? " signals__featured" : ""), id: "sig-" + (s.id || ""), "data-item-id": s.id || "" },
      imageBlock(rec, s.source, featured ? "media-feat" : "media-card", true),
      h("div", { class: "signal__body" },
        h("div", { class: "signal__meta" }, h("span", null, s.category || ""), sentChip(s.sentiment)),
        credRow(s, isTop),
        h("h3", { class: "signal__head" }, url ? h("a", { class: "uline", href: url, target: "_blank", rel: "noopener" }, s.title) : s.title),
        s.why_it_matters ? h("p", { class: "signal__why" }, h("b", null, "Why it matters"), s.why_it_matters) : (s.summary ? h("p", { class: "signal__why" }, s.summary) : null),
        h("div", { class: "signal__foot" }, h("span", { class: "t-caption muted num" }, s.source || ""),
          h("span", { class: "signal__foot-actions" }, shareBtn,
            saveStar({ id: s.id, title: s.title, url: url, source: s.source, edition_id: edId, type: "signal", category: s.category })))));
  }
  function signals(ed, assets) {
    var arr = ed.top_signals || []; if (!arr.length) return null;
    var maxSig = Math.max.apply(null, arr.map(function (s) { return s.significance || 0; }));
    var topId = null; for (var i = 0; i < arr.length; i++) { if ((arr[i].significance || 0) === maxSig) { topId = arr[i].id; break; } }
    var rest = arr.slice(1).map(function (s) { return signalCard(s, assets, false, ed.id, s.id === topId); });
    return blk("signals", "02", "Top Signals", h("div", null, signalCard(arr[0], assets, true, ed.id, arr[0].id === topId), rest.length ? h("div", { class: "signals__list" }, rest) : null));
  }

  function ascroll(label, items, axis, speed, cls) {
    return h("section", { class: "ascroll " + (cls || ""), "data-axis": axis || "y", "data-speed": speed || "" },
      h("div", { class: "ascroll__head" }, h("span", { class: "ascroll__label eyebrow" }, label || ""),
        h("button", { class: "ascroll__toggle", type: "button", "aria-pressed": "false", "aria-label": "Pause auto-scroll" }, "⏸")),
      h("div", { class: "ascroll__view", tabindex: "0", role: "list", "aria-label": label || "list" }, h("ul", { class: "ascroll__track" }, items)));
  }

  /* rail rows (radar/worth) — 3-part: thumb-link + title-link + star */
  function railRow(item, kicker, assets, edId) {
    var url = safeUrl(item.url), title = item.title || item.note || "", rec = imgFor(item, assets);
    var thumbImg = h("img", { src: rec && rec.img, alt: "", loading: "lazy", decoding: "async" });
    var thumb = (rec && rec.img)
      ? (url ? h("a", { class: "rail-row__thumb img-glass", href: url, target: "_blank", rel: "noopener", "aria-hidden": "true", tabindex: "-1" }, thumbImg) : h("span", { class: "rail-row__thumb img-glass" }, thumbImg))
      : h("span", { class: "rail-row__thumb" }, h("span", { class: "rail-row__mono" }, monogram(item.source || title)));
    var titleEl = url ? h("a", { class: "rail-row__title uline", href: url, target: "_blank", rel: "noopener" }, title) : h("span", { class: "rail-row__title" }, title);
    var star = item.id ? saveStar({ id: item.id, title: title, url: url, source: item.source, edition_id: edId, type: kicker === "Worth a Read" ? "worth" : "radar", category: item.category }) : null;
    return h("li", { role: "listitem" }, h("div", { class: "rail-row", "data-item-id": item.id || "" }, thumb,
      h("span", { class: "rail-row__body" }, h("span", { class: "rail-row__kicker" }, kicker + (item.category ? " · " + item.category : "")), titleEl, item.source ? h("span", { class: "rail-row__src num" }, item.source) : null), star));
  }
  function rail(ed, assets) {
    var rows = [];
    (ed.on_the_radar || []).forEach(function (r) { rows.push(railRow(r, "On the Radar", assets, ed.id)); });
    (ed.worth_a_read || []).forEach(function (w) { rows.push(railRow(w, "Worth a Read", assets, ed.id)); });
    var btc = (ed.market_snapshot && ed.market_snapshot.items && ed.market_snapshot.items[0]) || {};
    return h("aside", { class: "edition__rail", id: "rail" }, h("div", { class: "edition__rail-inner" },
      h("div", { class: "rail-meta" }, h("span", null, ed.type || "daily"), h("span", null, fmtDate(ed.id)), btc.value ? h("span", { class: "tick num" }, "BTC " + btc.value) : null),
      ascroll("On the Radar · Worth a Read", rows, "y", 22, "rail-ascroll"),
      h("div", { class: "rail-curation" }, h("span", { class: "lbl" }, "Curate this edition"), h("a", { class: "cta", href: "saved.html" }, "★ View your shortlist"))));
  }

  /* deals + resources */
  function dealCard(d) {
    var url = safeUrl(d.url), inv = Array.isArray(d.investors) ? d.investors : [];
    return h("li", { role: "listitem" }, h("a", { class: "ascard ascard--deal", href: url || "#", target: url ? "_blank" : null, rel: "noopener" },
      h("div", { class: "ascard__body" }, h("div", { class: "ascard__kicker" }, d.round ? h("span", { class: "chip" }, d.round) : null, d.category ? h("span", null, d.category) : null),
        h("div", { class: "ascard__title" }, d.company),
        h("div", { class: "ascard__row" }, h("span", { class: "ascard__amt num" }, d.amount || "—"), h("span", { class: "ascard__amt-lbl" }, "raised")),
        h("div", { class: "ascard__sub" }, inv.length ? inv.join(", ") : (d.summary || "")))));
  }
  function deals(ed) {
    var arr = ed.deals || []; if (!arr.length) return null;
    return blk("deals", "03", "Deals", ascroll("Latest raises · hover to browse", arr.map(dealCard), "y", 16, "deals-scroll deals-grid"));
  }
  function resCard(it, cat, assets, edId) {
    var url = safeUrl(it.url), rec = imgFor(it, assets);
    var thumb = (rec && rec.img)
      ? (url ? h("a", { class: "res-asrow__thumb img-glass", href: url, target: "_blank", rel: "noopener", "aria-hidden": "true", tabindex: "-1" }, h("img", { src: rec.img, alt: "", loading: "lazy", decoding: "async" })) : h("span", { class: "res-asrow__thumb img-glass" }, h("img", { src: rec.img, alt: "", loading: "lazy", decoding: "async" })))
      : h("span", { class: "res-asrow__thumb" }, h("span", { class: "res-asrow__mono" }, monogram(it.source || it.title)));
    var titleEl = url ? h("a", { class: "res-asrow__title uline", href: url, target: "_blank", rel: "noopener" }, it.title) : h("span", { class: "res-asrow__title" }, it.title);
    var star = it.id ? saveStar({ id: it.id, title: it.title, url: url, source: it.source, edition_id: edId, type: "resource", category: cat }) : null;
    return h("li", { role: "listitem" }, h("div", { class: "res-asrow", "data-item-id": it.id || "" }, thumb,
      h("span", { class: "res-asrow__txt" }, h("span", { class: "res-asrow__kicker" }, cat || ""), titleEl, it.source ? h("span", { class: "res-asrow__src num" }, it.source) : null), star));
  }
  function resources(ed, assets) {
    var arr = ed.all_resources || []; if (!arr.length) return null;
    var speeds = [18, 24, 21];
    var cols = arr.map(function (g, i) { return ascroll(g.category || "Resources", (g.items || []).map(function (it) { return resCard(it, g.category, assets, ed.id); }), "y", speeds[i % 3], ""); });
    return h("section", { class: "blk reveal", id: "resources" }, h("div", { class: "blk-head" }, h("span", { class: "blk-num num" }, "04"), h("h2", { class: "blk-title" }, "All Resources")), h("div", { class: "res-cols" }, cols));
  }

  function footer() {
    function col(t, ls) { return h("div", null, h("h4", null, t), h("ul", null, ls.map(function (l) { return h("li", null, h("a", { href: l[1] || "#" }, l[0])); }))); }
    return h("footer", { class: "foot" }, h("div", { class: "wrap foot-grid" },
      h("div", { class: "foot-brand" }, h("span", { class: "wordmark" }, h("span", { class: "dot" }), "Blockwall"), h("p", null, "Markets intelligence for crypto builders and investors. European Crypto Venture Capital · Frankfurt.")),
      col("Editions", [["Daily", "daily.html"], ["Weekly", "weekly.html"], ["Monthly", "monthly.html"], ["Archive", "archive.html"]]),
      col("Browse", [["Archive", "archive.html"], ["Saved", "saved.html"], ["Home", "index.html"]]),
      col("Blockwall", [["About", "#"], ["Subscribe", "#"], ["Substack", "#"]])));
  }

  function leadBody(ed) { var t = (ed.lead || {}).tldr || ""; if (t.length <= 320) return null; return blk(null, null, null, h("p", { class: "measure" }, t), "intro"); }
  function keyTakeaways(ed) {
    var arr = (ed.top_signals || []).slice(0, 5); if (arr.length < 2) return null;
    var items = arr.map(function (s) {
      var sent = s.sentiment || "neutral";
      return h("li", { class: "kt-item" }, h("span", { class: "kt-dot " + sent, "aria-label": sent }), h("span", { class: "kt-text" }, s.why_it_matters || s.title || ""));
    });
    return blk(null, null, null, h("div", { class: "kt" }, h("div", { class: "eyebrow kt-head" }, "Key takeaways"), h("ul", { class: "kt-list" }, items)), "kt-block");
  }
  function whatToWatch(ed) {
    var arr = ed.what_to_watch || []; if (!arr.length) return null;
    var items = arr.map(function (w) { var t = typeof w === "string" ? w : (w.label || w.title || w.text || w.note || ""); var u = safeUrl(typeof w === "object" ? w.url : null);
      return h("li", { class: "wtw-item" }, h("span", { class: "wtw-arrow", html: ICON.chev }), u ? h("a", { class: "uline", href: u, target: "_blank", rel: "noopener" }, t) : h("span", null, t)); });
    return h("section", { class: "blk reveal", id: "watch" }, h("div", { class: "blk-head" }, h("span", { class: "blk-num num" }, "05"), h("h2", { class: "blk-title" }, "What to Watch")), h("ul", { class: "wtw-list" }, items));
  }
  function linkedinBlock(ed) {
    var t = ed.linkedin_post; if (!t || typeof t !== "string" || !t.trim()) return null;
    var btn = h("button", { class: "li-copy", type: "button" }, h("span", { class: "li-copy-ico", "aria-hidden": "true", html: ICON.link }), h("span", { class: "hero__share-txt" }, "Copy for LinkedIn"));
    btn.addEventListener("click", function () { copyToClipboard(t, btn, "Copied for LinkedIn"); });
    return h("section", { class: "blk reveal li-block", id: "linkedin" },
      h("div", { class: "blk-head" }, h("span", { class: "blk-num num" }, "06"), h("h2", { class: "blk-title" }, "LinkedIn-ready"), h("span", { class: "li-hint t-caption muted" }, "Desk-written, ready to paste")),
      h("div", { class: "li-card" }, h("p", { class: "li-text" }, t), h("div", { class: "li-actions" }, btn)));
  }

  /* behaviors */
  function wire() {
    var mh = document.getElementById("masthead"), prog = document.getElementById("scroll-progress");
    function onScroll() { if (mh) mh.classList.toggle("is-stuck", window.scrollY > 90); if (prog) { var sc = document.documentElement.scrollHeight - window.innerHeight; prog.style.width = (sc > 0 ? window.scrollY / sc * 100 : 0) + "%"; } }
    window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
    var spyLinks = [].slice.call(document.querySelectorAll('.subnav a[href^="#"]'));
    spyLinks.forEach(function (a) { a.addEventListener("click", function (e) { var t = document.querySelector(a.getAttribute("href")); if (t) { e.preventDefault(); spyLinks.forEach(function (x) { x.removeAttribute("aria-current"); }); a.setAttribute("aria-current", "true"); if (window.__lenis) window.__lenis.scrollTo(t, { offset: -70 }); else t.scrollIntoView({ behavior: "smooth", block: "start" }); } }); });
    var rm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (window.IntersectionObserver && !rm) {
      var io = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("in-view"); io.unobserve(en.target); } }); }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
      document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });
    } else { document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in-view"); }); }
    document.querySelectorAll(".sigx-fill").forEach(function (p) { var off = p.getAttribute("data-off"); if (rm) { p.style.strokeDashoffset = off; } else { setTimeout(function () { p.style.strokeDashoffset = off; }, 240); } });
    if (window.AutoScroll) document.querySelectorAll(".ascroll").forEach(function (s) { AutoScroll.init(s, { axis: s.getAttribute("data-axis") || "y", speed: parseFloat(s.getAttribute("data-speed")) || 20 }); });
    if (matchMedia("(hover:hover) and (pointer:fine)").matches) document.addEventListener("pointermove", function (e) {
      var c = e.target.closest && e.target.closest(".signal,.ascard,.home-card"); if (!c) return; var r = c.getBoundingClientRect();
      c.style.setProperty("--mx", (e.clientX - r.left) + "px"); c.style.setProperty("--my", (e.clientY - r.top) + "px");
    }, { passive: true });
    /* scrollspy — persistent observer (works under reduced-motion; reveal IO left untouched) */
    (function () {
      var links = spyLinks; if (!links.length) return;
      var map = {}, secs = [], visible = {};
      links.forEach(function (a) { var sec = document.querySelector(a.getAttribute("href")); if (sec) { map[sec.id] = a; secs.push(sec); } });
      if (!secs.length) return;
      function setActive() {
        var id;
        if (window.scrollY < 4) id = secs[0].id;
        else if ((window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 4) id = secs[secs.length - 1].id;
        else { var top = Infinity; Object.keys(visible).forEach(function (k) { var tp = visible[k].getBoundingClientRect().top; if (tp < top) { top = tp; id = k; } }); }
        if (!id) return;
        links.forEach(function (a) { a.removeAttribute("aria-current"); });
        var active = map[id]; if (!active) return; active.setAttribute("aria-current", "true");
        if (matchMedia("(max-width:640px)").matches && !rm) active.scrollIntoView({ inline: "center", block: "nearest" });
      }
      if (window.IntersectionObserver) {
        var spyIO = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) visible[en.target.id] = en.target; else delete visible[en.target.id]; }); setActive(); }, { rootMargin: "-15% 0px -80% 0px", threshold: 0 });
        secs.forEach(function (sec) { spyIO.observe(sec); });
      }
      setActive();
    })();
    /* Signal-Index methodology popover */
    (function () {
      var info = document.querySelector(".sigx-info"), panel = document.getElementById("sigx-method");
      if (!info || !panel) return; var wrap = info.closest(".sigx-meta");
      function show() { panel.hidden = false; info.setAttribute("aria-expanded", "true"); }
      function hide() { panel.hidden = true; info.setAttribute("aria-expanded", "false"); info.removeAttribute("data-pinned"); }
      info.addEventListener("mouseenter", show);
      if (wrap) wrap.addEventListener("mouseleave", function () { if (info.getAttribute("data-pinned") !== "1") hide(); });
      info.addEventListener("click", function (e) { e.stopPropagation(); if (panel.hidden) { show(); info.setAttribute("data-pinned", "1"); } else hide(); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) { hide(); info.focus(); } });
      document.addEventListener("click", function (e) { if (!panel.hidden && !panel.contains(e.target) && e.target !== info && !info.contains(e.target)) hide(); });
    })();
    /* share / copy-permalink */
    if (!document.getElementById("bw-toast")) document.body.appendChild(h("div", { class: "bw-toast", id: "bw-toast", role: "status", "aria-live": "polite", "aria-atomic": "true" }));
    var edShare = document.querySelector(".hero__share");
    if (edShare && _ed) edShare.addEventListener("click", function () { shareOrCopy(location.origin + location.pathname + "?id=" + _ed.id, (_ed.lead && _ed.lead.headline) || "Blockwall edition", edShare); });
    document.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".signal__share"); if (!b) return;
      var art = b.closest(".signal"); var id = art && art.id; if (!id || !_ed) return;
      shareOrCopy(location.origin + location.pathname + "?id=" + _ed.id + "#" + id, "Blockwall signal", b);
    });
    /* deep-link fragment scroll */
    if (location.hash) { var tgt = document.getElementById(location.hash.slice(1)); if (tgt) { if (window.__lenis) setTimeout(function () { window.__lenis.scrollTo(tgt, { offset: -70 }); }, 60); else tgt.scrollIntoView({ block: "start" }); } }
    if (Store) {
      Store.subscribe(function () { syncBadge(); refreshStars(); });
      if (_ed) Store.setEdition(_ed);   /* hydrate saved state from the live API for this edition */
      syncBadge();
    }
  }

  /* ---------- Portfolio Moves (weekly/monthly only) ----------------------------
     Sourced CLIENT-SIDE from data/portfolio/* — the editions pipeline/JSON is never
     touched. Reuses the river item component (.pf-* from assets/css/portfolio.css,
     loaded on the weekly/monthly skeletons) with root-relative paths. */
  var PF_FUND_RE = /rais(e|ed|ing)|seed|pre-seed|series|funding round/i;
  var PF_MIN_SIG = 6;     // knob: significance threshold. NOTE: the collector currently
                          // writes a uniform significance_score of 5, so this arm is inert
                          // until real scoring lands — today "moves" = funding posts.
  var PF_MAX_MOVES = 8;
  var PF_STATUS = { Active: { cls: "pf-status--active", label: "Live", live: true }, Inactive: { cls: "pf-status--inactive", label: "Inactive" }, "Wind-down": { cls: "pf-status--winddown", label: "Winding down" }, "Write-off": { cls: "pf-status--writeoff", label: "Acquired / closed" } };
  function pfRel(iso) { if (!iso) return ""; var t = Date.parse(iso); if (isNaN(t)) return ""; var d = Math.round((Date.now() - t) / 1000), fut = d < 0, a = Math.abs(d), s; if (a < 60) return fut ? "soon" : "just now"; if (a < 3600) s = Math.floor(a / 60) + "m"; else if (a < 86400) s = Math.floor(a / 3600) + "h"; else if (a < 2592000) s = Math.floor(a / 86400) + "d"; else if (a < 31536000) s = Math.floor(a / 2592000) + "mo"; else s = Math.floor(a / 31536000) + "y"; return fut ? "in " + s : s + " ago"; }
  function pfIsFund(it) { var t = (it.tags || []).map(function (x) { return String(x).toLowerCase(); }); if (t.some(function (x) { return /fund|raise|seed|series|round|investment/.test(x); })) return true; return PF_FUND_RE.test(it.title || ""); }
  function pfStatusBadge(status) { var def = PF_STATUS[status] || PF_STATUS.Active; var s = h("span", { class: "pf-status " + def.cls }); if (def.live) s.appendChild(h("span", { class: "pf-livedot" })); s.appendChild(document.createTextNode(def.label)); return s; }
  function pfMonth(y, mo) { return { start: Date.UTC(y, mo, 1), end: Date.UTC(mo === 11 ? y + 1 : y, (mo + 1) % 12, 1) }; }
  function pfWindow(ed) {
    if (ed.type === "monthly") {
      var m = /^(\d{4})-(\d{2})$/.exec(String(ed.id || "")); if (m) return pfMonth(+m[1], +m[2] - 1);
      var d = new Date((ed.date_display || "") + " 1"); if (!isNaN(d)) return pfMonth(d.getFullYear(), d.getMonth()); return null;
    }
    if (ed.type === "weekly") {
      // date_display ("Week 25 · June 9 - June 15, 2026") is the authoritative period —
      // the pipeline's weeks aren't ISO-Mon-Sun, so parse the displayed range.
      var mm = /([A-Za-z]+\s+\d{1,2})\s*[-–]\s*([A-Za-z]+\s+\d{1,2}),?\s*(\d{4})/.exec(ed.date_display || "");
      if (mm) { var yr = +mm[3], sD = new Date(mm[1] + ", " + yr), eD = new Date(mm[2] + ", " + yr); if (isNaN(sD) || isNaN(eD)) return null; if (sD > eD) sD = new Date(mm[1] + ", " + (yr - 1)); return { start: Date.UTC(sD.getFullYear(), sD.getMonth(), sD.getDate()), end: Date.UTC(eD.getFullYear(), eD.getMonth(), eD.getDate()) + 86400000 }; }
      return null;
    }
    return null;
  }
  function pfLogo(co, imgCls, monoCls) { var name = (co && co.name) || (co && co.slug) || ""; if (co && co.logo) { var img = h("img", { class: imgCls, src: "assets/companies/" + co.logo, alt: "", loading: "lazy", decoding: "async" }); img.addEventListener("error", function () { var p = img.parentNode; if (p) p.replaceChild(h("span", { class: monoCls }, monogram(name)), img); }); return img; } return h("span", { class: monoCls }, monogram(name)); }
  function pfThumb(it, co) { var box = h("div", { class: "pf-thumb" }), mono = monogram((co && co.name) || it.company_name || it.publisher); function cover() { return h("div", { class: "pf-cover" }, h("span", { class: "pf-cover__mono" }, mono)); } if (it.image_url) { var img = h("img", { src: it.image_url, alt: "", loading: "lazy", decoding: "async" }); img.addEventListener("error", function () { if (box.contains(img)) box.replaceChild(cover(), img); }); box.appendChild(img); } else box.appendChild(cover()); return box; }
  function pfMoveCard(it, co) {
    co = co || { slug: it.company_slug, name: it.company_name };
    var chip = pfIsFund(it) ? h("span", { class: "pf-chip pf-chip--funding" }, "Funding") : (it.source_type === "news" ? h("span", { class: "pf-chip pf-chip--news" }, "News") : h("span", { class: "pf-chip pf-chip--blog" }, "Blog"));
    var rel = pfRel(it.date_published), meta = h("div", { class: "pf-item-meta" }, it.publisher || "");
    if (rel) { meta.appendChild(h("span", { class: "sep" }, "·")); meta.appendChild(document.createTextNode(rel)); }
    var body = h("div", { class: "pf-item-body" },
      h("div", { class: "pf-item-top" }, h("a", { class: "pf-co", href: "portfolio/company.html?slug=" + encodeURIComponent(co.slug) }, pfLogo(co, "pf-co__logo", "pf-co__mono"), (co.name || it.company_name)), chip, pfStatusBadge(co.status)),
      h("a", { class: "pf-item-title", href: safeUrl(it.url) || it.url, target: "_blank", rel: "noopener" }, it.title || "Untitled"),
      it.summary_short ? h("div", { class: "pf-item-summary" }, it.summary_short) : null, meta);
    return h("article", { class: "pf-item" }, pfThumb(it, co), body);
  }
  function pfMoves(ed) {
    var w = pfWindow(ed); if (!w) return;
    Promise.all([jget("data/portfolio/items.json"), jget("data/portfolio/companies.json")]).then(function (res) {
      var items = (res[0] && res[0].items) || [], reg = (res[1] && res[1].companies) || [], coBySlug = {};
      reg.forEach(function (c) { coBySlug[c.slug] = c; });
      var moves = items.filter(function (it) { if (!it.date_published) return false; var t = Date.parse(it.date_published); if (isNaN(t) || t < w.start || t >= w.end) return false; return pfIsFund(it) || (it.significance_score || 0) >= PF_MIN_SIG; });
      if (!moves.length) return;   // empty window -> hide the section entirely
      moves.sort(function (a, b) { return ((b.significance_score || 0) - (a.significance_score || 0)) || (a.date_published < b.date_published ? 1 : -1); });
      moves = moves.slice(0, PF_MAX_MOVES);
      var sec = blk("portfolio-moves", null, "Portfolio Moves", h("div", null,
        h("p", { class: "pf-moves-sub t-caption muted" }, "Funding and notable updates from the Blockwall portfolio this " + (ed.type === "monthly" ? "month" : "week") + " · " + moves.length + " of " + reg.length + " companies."),
        h("div", { class: "pf-river pf-moves" }, moves.map(function (it) { return pfMoveCard(it, coBySlug[it.company_slug]); }))));
      var lower = document.querySelector("main .wrap.lower");
      if (lower) lower.insertBefore(sec, lower.firstChild);
      else { var mn = document.querySelector("main"); if (mn) mn.appendChild(h("div", { class: "wrap lower" }, sec)); }
    }).catch(function () { /* portfolio data unavailable — silently skip, editions unaffected */ });
  }

  function build(ed, no, assets) {
    var app = document.getElementById("app");
    app.appendChild(masthead(ed, no));
    var lt = liveTape(ed); if (lt) app.appendChild(lt);
    app.appendChild(h("div", { class: "scroll-progress", id: "scroll-progress" }));
    var heroRec = imgFor((ed.top_signals && ed.top_signals[0]) || {}, assets);
    var main = h("main", null,
      h("div", { class: "wrap edition" }, h("div", { class: "edition__main" }, hero(ed, no, heroRec && heroRec.img),
        ed.intro ? blk(null, null, null, h("p", { class: "measure" }, ed.intro), "intro") : null, leadBody(ed), keyTakeaways(ed), tape(ed), statsBlock(ed), signals(ed, assets), pullQuote(ed)), rail(ed, assets)),
      h("div", { class: "wrap lower" }, deals(ed), resources(ed, assets), whatToWatch(ed), linkedinBlock(ed)));
    app.appendChild(main);
    var ednav = editionNav(_nav); if (ednav) app.appendChild(h("div", { class: "wrap" }, ednav));
    app.appendChild(window.BWBrand ? window.BWBrand.footer() : footer()); wire();
  }

  var SCHEMA_VERSION = 2;
  function renderUpdateNeeded(declared) {
    document.getElementById("app").innerHTML = '<div class="wrap" style="padding:80px 0;max-width:640px">'
      + '<p class="eyebrow" style="color:var(--accent-link)">Update needed</p>'
      + '<h1 class="hero__title" style="font-size:2rem;margin:10px 0">This edition is newer than the site</h1>'
      + '<p class="secondary">It declares schema v' + declared + '; this page understands v' + SCHEMA_VERSION + '. Refresh, or browse the <a class="uline" href="archive.html">archive</a>.</p></div>';
  }
  var qid = new URLSearchParams(location.search).get("id");
  var MANIFEST = CFG.manifest || "data/daily.json";
  var DIR = CFG.dir || "data/daily";
  var CAD = (MANIFEST.match(/([a-z]+)\.json/) || [])[1] || "daily";
  function renderNoEditions() {
    document.getElementById("app").innerHTML = '<div class="wrap" style="padding:90px 0;max-width:640px">'
      + '<p class="eyebrow" style="color:var(--accent-link)">' + CAD.charAt(0).toUpperCase() + CAD.slice(1) + '</p>'
      + '<h1 class="hero__title" style="font-size:clamp(1.8rem,3vw,2.4rem);margin:10px 0">No ' + CAD + ' editions yet</h1>'
      + '<p class="secondary">This cadence has not published an edition yet. Browse the <a class="uline" href="archive.html">archive</a>, or read the <a class="uline" href="daily.html">latest daily</a>.</p></div>';
  }
  function jget(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }
  jget(MANIFEST).catch(function () { return []; }).then(function (man) {
    man = Array.isArray(man) ? man : [];
    var rid = (qid && /^[\w][\w.-]*$/.test(qid)) ? qid : (man[0] && man[0].id);
    if (!rid) { renderNoEditions(); return; }
    return jget(DIR + "/" + rid + ".json").then(function (ed) {
      var declared = (ed.schema_version != null) ? ed.schema_version : ed.schema;
      if (typeof declared === "number" && declared > SCHEMA_VERSION) { renderUpdateNeeded(declared); return; }
      var assets = { images: {} };
      var no = null, older = null, newer = null;
      var idx = man.findIndex(function (e) { return e.id === ed.id; });
      if (idx >= 0) { no = man.length - idx; older = man[idx + 1] || null; newer = idx > 0 ? man[idx - 1] : null; }
      _ed = ed; _man = man; _nav = { older: older, newer: newer };
      build(ed, no, assets);
      if (window.LiveTape && !qid && ed.type === "daily") window.LiveTape.upgrade(ed);
      if (ed.type === "weekly" || ed.type === "monthly") pfMoves(ed);
    });
  }).catch(function (e) { document.getElementById("app").innerHTML = '<p style="padding:48px;color:#f66">Failed to load: ' + (e && e.message) + "</p>"; });
})();
