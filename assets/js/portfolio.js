/* Blockwall Portfolio — river feed + per-company drill-down.
   Drives portfolio/index.html (data-page="river") and portfolio/company.html
   (data-page="company"). Self-contained: reads the live data contracts, reuses
   the Signal Desk chrome/tokens. Pages live one level deep, so BASE = "../". */
(function () {
  "use strict";
  var BASE = "../";
  var DATA = BASE + "data/portfolio/";

  /* ---------- tiny DOM helper (auto-escapes text children) ---------- */
  function h(tag, attrs) {
    var e = document.createElement(tag), i, k, v, c;
    if (attrs) for (k in attrs) { v = attrs[k]; if (v == null) continue;
      if (k === "html") e.innerHTML = v; else if (k === "class") e.className = v; else e.setAttribute(k, v); }
    for (i = 2; i < arguments.length; i++) { c = arguments[i]; if (c == null) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x != null) e.appendChild(typeof x === "object" ? x : document.createTextNode(String(x))); });
      else e.appendChild(typeof c === "object" ? c : document.createTextNode(String(c))); }
    return e;
  }
  function frag() { return document.createDocumentFragment(); }

  /* ---------- helpers ---------- */
  function monogram(s) {
    s = String(s || "").trim(); if (!s) return "BW";
    var p = s.split(/[\s._\/-]+/).filter(Boolean);
    if (p.length >= 2) return (p[0].charAt(0) + p[1].charAt(0)).toUpperCase();
    return (s.replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || "BW").toUpperCase();
  }
  function relTime(iso) {
    if (!iso) return "";
    var t = Date.parse(iso); if (isNaN(t)) return "";
    var diff = Math.round((Date.now() - t) / 1000), future = diff < 0, a = Math.abs(diff), s;
    if (a < 60) return future ? "soon" : "just now";
    if (a < 3600) s = Math.floor(a / 60) + "m";
    else if (a < 86400) s = Math.floor(a / 3600) + "h";
    else if (a < 2592000) s = Math.floor(a / 86400) + "d";
    else if (a < 31536000) s = Math.floor(a / 2592000) + "mo";
    else s = Math.floor(a / 31536000) + "y";
    return future ? "in " + s : s + " ago";
  }
  var FUND_RE = /rais(e|ed|ing)|seed|pre-seed|series|funding round/i;
  function isFunding(it) {
    var tags = (it.tags || []).map(function (t) { return String(t).toLowerCase(); });
    if (tags.some(function (t) { return /fund|raise|seed|series|round|investment/.test(t); })) return true;
    return FUND_RE.test(it.title || "");
  }
  function sourceChip(it) {
    if (isFunding(it)) return h("span", { class: "pf-chip pf-chip--funding" }, "Funding");
    if (it.source_type === "news") return h("span", { class: "pf-chip pf-chip--news" }, "News");
    return h("span", { class: "pf-chip pf-chip--blog" }, "Blog");
  }
  function sentDot(it) {
    var s = it.sentiment; if (!s || s === "neutral") return null;
    return h("span", { class: "pf-dot pf-dot--" + s, title: s, "aria-label": "Sentiment: " + s });
  }
  var STATUS = {
    Active:      { cls: "pf-status--active",   label: "Live",            live: true },
    Inactive:    { cls: "pf-status--inactive", label: "Inactive" },
    "Wind-down": { cls: "pf-status--winddown", label: "Winding down" },
    "Write-off": { cls: "pf-status--writeoff", label: "Acquired / closed" }
  };
  function statusBadge(status) {
    var def = STATUS[status] || STATUS.Active;
    var span = h("span", { class: "pf-status " + def.cls });
    if (def.live) span.appendChild(h("span", { class: "pf-livedot" }));
    span.appendChild(document.createTextNode(def.label));
    return span;
  }
  function isDead(status) { return status === "Write-off" || status === "Inactive" || status === "Wind-down"; }

  /* logo <img> that degrades to a monogram tile on error/missing */
  function logoEl(company, imgCls, monoCls) {
    var name = (company && company.name) || (company && company.slug) || "";
    if (company && company.logo) {
      var img = h("img", { class: imgCls, src: BASE + "assets/companies/" + company.logo, alt: "", loading: "lazy", decoding: "async" });
      img.addEventListener("error", function () { var p = img.parentNode; if (p) { var m = h("span", { class: monoCls }, monogram(name)); p.replaceChild(m, img); } });
      return img;
    }
    return h("span", { class: monoCls }, monogram(name));
  }
  /* article thumbnail (image_url) -> branded cover on error/null */
  function thumb(it, company) {
    var box = h("div", { class: "pf-thumb" });
    var mono = monogram((company && company.name) || it.company_name || it.publisher);
    function cover() { return h("div", { class: "pf-cover" }, h("span", { class: "pf-cover__mono" }, mono)); }
    if (it.image_url) {
      var img = h("img", { src: it.image_url, alt: "", loading: "lazy", decoding: "async" });
      img.addEventListener("error", function () { if (box.contains(img)) box.replaceChild(cover(), img); });
      box.appendChild(img);
    } else box.appendChild(cover());
    return box;
  }

  function itemCard(it, coBySlug) {
    var co = coBySlug[it.company_slug] || { slug: it.company_slug, name: it.company_name };
    var rel = relTime(it.date_published);
    var top = h("div", { class: "pf-item-top" },
      h("a", { class: "pf-co", href: "company.html?slug=" + encodeURIComponent(co.slug) },
        logoEl(co, "pf-co__logo", "pf-co__mono"), (co.name || it.company_name)),
      sourceChip(it), sentDot(it));
    var meta = h("div", { class: "pf-item-meta" }, it.publisher || "");
    if (rel) { meta.appendChild(h("span", { class: "sep" }, "·")); meta.appendChild(document.createTextNode(rel)); }
    var body = h("div", { class: "pf-item-body" },
      top,
      h("a", { class: "pf-item-title", href: it.url, target: "_blank", rel: "noopener" }, it.title || "Untitled"),
      it.summary_short ? h("div", { class: "pf-item-summary" }, it.summary_short) : null,
      meta);
    return h("article", { class: "pf-item" + (it.date_published ? "" : " is-undated") }, thumb(it, co), body);
  }

  function jget(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status + " " + u); return r.json(); }); }
  function wordmark() {
    fetch(BASE + "assets/img/bw-wordmark.svg").then(function (r) { return r.ok ? r.text() : ""; }).then(function (t) {
      if (t.indexOf("<svg") >= 0) document.querySelectorAll(".bw-mark").forEach(function (m) { m.innerHTML = t; });
    }).catch(function () {});
  }

  /* ---------- river page ---------- */
  function renderRiver() {
    Promise.all([jget(DATA + "indexes/latest.json"), jget(DATA + "companies.json")]).then(function (res) {
      var feed = res[0].items || [], reg = res[1].companies || [];
      var coBySlug = {}; reg.forEach(function (c) { coBySlug[c.slug] = c; });

      // hero stats
      var active = reg.filter(function (c) { return c.status === "Active"; }).length;
      setText("pf-stat-companies", reg.length);
      setText("pf-stat-active", active);
      setText("pf-stat-updates", feed.length);
      var dl = document.getElementById("pf-dateline"); if (dl) dl.textContent = "Portfolio · " + reg.length + " companies";

      // river (preserve given order: newest-first, nulls last — do NOT re-sort)
      var river = document.getElementById("pf-river-feed"); river.textContent = "";
      if (!feed.length) river.appendChild(h("div", { class: "pf-empty" }, "No updates yet."));
      else { var f = frag(); feed.forEach(function (it) { f.appendChild(itemCard(it, coBySlug)); }); river.appendChild(f); }

      // companies directory (+ sector filter), sorted: live first, then alpha
      var counts = {}; feed.forEach(function (it) { counts[it.company_slug] = (counts[it.company_slug] || 0) + 1; });
      var sorted = reg.slice().sort(function (a, b) {
        var da = isDead(a.status) ? 1 : 0, db = isDead(b.status) ? 1 : 0;
        if (da !== db) return da - db; return (a.name || "").localeCompare(b.name || "");
      });
      buildSectorFilter(reg);
      renderCompanyGrid(sorted, counts);
    }).catch(function (e) { showError("pf-river-feed", e); });
  }

  function renderCompanyGrid(list, counts) {
    var grid = document.getElementById("pf-companies-grid"); grid.textContent = "";
    var f = frag();
    list.forEach(function (c) {
      var n = counts[c.slug] || 0;
      var card = h("a", { class: "pf-co-card" + (isDead(c.status) ? " is-dead" : ""), href: "company.html?slug=" + encodeURIComponent(c.slug), "data-sector": c.sector || "" },
        h("div", { class: "pf-co-card__head" },
          logoEl(c, "pf-co-card__logo", "pf-co-card__mono"),
          h("div", null, h("div", { class: "pf-co-card__name" }, c.name), h("div", { class: "pf-co-card__sector" }, c.sector || ""))),
        c.description ? h("div", { class: "pf-co-card__desc" }, c.description) : null,
        h("div", { class: "pf-co-card__foot" }, statusBadge(c.status),
          h("span", { class: "pf-co-card__count" }, n ? (n + " recent") : "—")));
      f.appendChild(card);
    });
    grid.appendChild(f);
  }

  function buildSectorFilter(reg) {
    var host = document.getElementById("pf-filters"); if (!host) return;
    var sectors = []; reg.forEach(function (c) { if (c.sector && sectors.indexOf(c.sector) < 0) sectors.push(c.sector); });
    sectors.sort();
    var all = ["All"].concat(sectors);
    host.textContent = "";
    all.forEach(function (s, i) {
      var btn = h("button", { class: "pf-filter" + (i === 0 ? " is-active" : ""), type: "button" }, s);
      btn.addEventListener("click", function () {
        host.querySelectorAll(".pf-filter").forEach(function (b) { b.classList.remove("is-active"); });
        btn.classList.add("is-active");
        document.querySelectorAll("#pf-companies-grid .pf-co-card").forEach(function (card) {
          card.style.display = (s === "All" || card.getAttribute("data-sector") === s) ? "" : "none";
        });
      });
      host.appendChild(btn);
    });
  }

  /* ---------- company drill-down ---------- */
  var ICON = {
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M7 17 17 7M9 7h8v8"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 18l-6-6 6-6"/></svg>'
  };
  function renderCompany() {
    var slug = new URLSearchParams(location.search).get("slug");
    var root = document.getElementById("pf-company");
    if (!slug) { root.appendChild(h("div", { class: "pf-empty" }, "No company specified.")); return; }
    Promise.all([jget(DATA + "companies.json"), jget(DATA + "indexes/by-company/" + slug + ".json").catch(function () { return { items: [] }; })])
      .then(function (res) {
        var reg = res[0].companies || [], hist = (res[1] && res[1].items) || [];
        var c = reg.filter(function (x) { return x.slug === slug; })[0];
        if (!c) { root.appendChild(h("div", { class: "pf-empty" }, "Unknown company: " + slug)); return; }
        document.title = "Blockwall — " + c.name;
        var coBySlug = {}; coBySlug[c.slug] = c;

        var tags = h("div", { class: "pf-company-tags" }, statusBadge(c.status));
        if (c.sector) tags.appendChild(h("span", { class: "pf-chip" }, c.sector));
        if (c.industry) tags.appendChild(h("span", { class: "pf-chip pf-chip--news" }, c.industry));

        var links = h("div", { class: "pf-company-links" });
        if (c.website) links.appendChild(h("a", { class: "pf-link pf-link--primary", href: c.website, target: "_blank", rel: "noopener", html: "Website " + ICON.ext }));
        if (c.linkedin_url) links.appendChild(h("a", { class: "pf-link", href: c.linkedin_url, target: "_blank", rel: "noopener", html: ICON.linkedin + " LinkedIn" }));

        var head = h("div", { class: "pf-company-head" },
          logoEl(c, "pf-company-logo", "pf-company-mono"),
          h("div", { class: "pf-company-info" },
            h("h1", null, c.name), tags,
            c.description ? h("p", { class: "pf-company-desc" }, c.description) : null,
            links));

        var feed = h("div", { class: "pf-river" });
        if (!hist.length) feed.appendChild(h("div", { class: "pf-empty" }, "No updates collected yet for " + c.name + "."));
        else hist.forEach(function (it) { feed.appendChild(itemCard(it, coBySlug)); });

        root.textContent = "";
        root.appendChild(h("a", { class: "pf-back", href: "index.html", html: ICON.back + " All portfolio" }));
        root.appendChild(head);
        root.appendChild(h("div", { class: "pf-section-head" }, h("h2", null, "Update history"), h("span", { class: "pf-eyebrow" }, hist.length + " items")));
        root.appendChild(feed);
      }).catch(function (e) { showError("pf-company", e); });
  }

  /* ---------- utils + boot ---------- */
  function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
  function showError(id, e) { var el = document.getElementById(id); if (el) el.appendChild(h("div", { class: "pf-empty" }, "Couldn't load portfolio data. " + (e && e.message ? e.message : ""))); }

  /* hero brush-dash signature — reuse the exact shared editions/home primitive */
  function heroSpark() {
    var rule = document.getElementById("pf-hero-rule");
    if (rule && !rule.firstChild && window.BWSpark && window.BWSpark.brushDash) rule.appendChild(window.BWSpark.brushDash());
  }
  /* scroll-reveal — mirrors the editions/home IntersectionObserver (.reveal -> .in-view) */
  function revealWire() {
    var rm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (window.IntersectionObserver && !rm) {
      var io = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("in-view"); io.unobserve(en.target); } }); }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
      document.querySelectorAll(".reveal:not(.in-view)").forEach(function (el) { io.observe(el); });
    } else { document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in-view"); }); }
  }

  function boot() {
    document.documentElement.classList.add("dir-d");
    wordmark();
    heroSpark();
    var page = document.body.getAttribute("data-page");
    if (page === "company") renderCompany(); else renderRiver();
    revealWire();
  }
  if (document.readyState !== "loading") boot(); else document.addEventListener("DOMContentLoaded", boot);
})();
