/* Blockwall Portfolio — premium river + per-company drill-down.
   Drives portfolio/index.html (data-page="river") and portfolio/company.html
   (data-page="company"). Self-contained: reads the live data contracts, reuses
   the Signal Desk chrome/tokens/glass. Pages live one level deep, so BASE = "../".
   Premium surfaces: a glass + 3D-tilt posts scroller, a company bento mosaic, and
   a drill-down (.hero profile header + featured post + masonry) — all built from
   existing primitives (.glass/.img-glass, branded covers, brushDash, reveal). */
(function () {
  "use strict";
  var BASE = "../";
  var DATA = BASE + "data/portfolio/";
  var RM = function () { return matchMedia("(prefers-reduced-motion: reduce)").matches; };

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

  var ICON = {
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M7 17 17 7M9 7h8v8"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 18l-6-6 6-6"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'
  };

  /* ---------- helpers ---------- */
  function monogram(s) {
    s = String(s || "").trim(); if (!s) return "BW";
    var p = s.split(/[\s._\/-]+/).filter(Boolean);
    if (p.length >= 2) return (p[0].charAt(0) + p[1].charAt(0)).toUpperCase();
    return (s.replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || "BW").toUpperCase();
  }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(iso) { var t = Date.parse(iso); if (isNaN(t)) return ""; var d = new Date(t); return MON[d.getUTCMonth()] + " " + d.getUTCDate(); }
  /* stable per-entity hue (205–325: brand-aligned cool→indigo→violet→magenta band) so
     branded covers/blocks vary instead of reading as one repeated tile. CSS default 222. */
  function pfHue(seed) {
    seed = String(seed || ""); var n = 0;
    for (var i = 0; i < seed.length; i++) n = (n * 31 + seed.charCodeAt(i)) >>> 0;
    return 205 + (n % 120);
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
  function sourceMeta(it) {
    if (isFunding(it)) return { k: "funding", t: "Funding" };
    if (it.source_type === "news") return { k: "news", t: "News" };
    return { k: "blog", t: "Blog" };
  }
  function sourceChip(it) { var m = sourceMeta(it); return h("span", { class: "pf-chip pf-chip--" + m.k }, m.t); }
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
    if (def.live) span.appendChild(h("span", { class: "pf-livedot", "aria-hidden": "true" }));
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
  /* article thumbnail (image_url) -> branded cover on error/null (used by the .pf-item list) */
  function thumb(it, company) {
    var box = h("div", { class: "pf-thumb" });
    var mono = monogram((company && company.name) || it.company_name || it.publisher);
    function cover() { var el = h("div", { class: "pf-cover" }, h("span", { class: "pf-cover__mono" }, mono)); el.style.setProperty("--pf-hue", pfHue(it.id || it.title || (company && company.slug) || mono)); return el; }
    if (it.image_url) {
      var img = h("img", { src: it.image_url, alt: "", loading: "lazy", decoding: "async" });
      img.addEventListener("error", function () { if (box.contains(img)) box.replaceChild(cover(), img); });
      box.appendChild(img);
    } else box.appendChild(cover());
    return box;
  }

  /* compact river row (used by the "All updates" list + as a fallback) */
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

  /* ---------- premium: glass post card (scroller + masonry + featured) ---------- */
  function coverEl(it, co) {
    var name = (co && co.name) || it.company_name || it.publisher, mono = monogram(name), m = sourceMeta(it);
    var box = h("div", { class: "pf-pcard__cover" });
    function branded() { var el = h("div", { class: "pf-cover" }, h("span", { class: "pf-cover__mono" }, mono)); el.style.setProperty("--pf-hue", pfHue(it.id || it.title || name)); return el; }
    if (it.image_url) {
      var img = h("img", { class: "pf-pcard__img", src: it.image_url, alt: "", loading: "lazy", decoding: "async" });
      img.addEventListener("error", function () { if (box.contains(img)) box.replaceChild(branded(), img); });
      box.appendChild(img);
    } else box.appendChild(branded());
    box.appendChild(h("span", { class: "pf-pcard__badge pf-pcard__badge--" + m.k, "aria-hidden": "true" }, m.t));
    return box;
  }
  function postCard(it, coBySlug, featured) {
    var co = coBySlug[it.company_slug] || { slug: it.company_slug, name: it.company_name };
    var meta = h("div", { class: "pf-pcard__meta" },
      h("span", { class: "pf-pcard__co" }, logoEl(co, "pf-pcard__co-logo", "pf-pcard__co-mono"), (co.name || it.company_name)),
      h("span", { class: "pf-pcard__date" }, sentDot(it), relTime(it.date_published) || fmtDate(it.date_published)));
    var body = h("div", { class: "pf-pcard__body" },
      h("h3", { class: "pf-pcard__title" }, it.title || "Untitled"),
      featured && it.summary_short ? h("p", { class: "pf-pcard__summary" }, it.summary_short) : null,
      meta);
    return h("a", { class: "pf-pcard" + (featured ? " pf-pcard--featured" : ""), href: it.url, target: "_blank", rel: "noopener", "data-tilt": "" },
      coverEl(it, co), body);
  }

  function postScroller(items, coBySlug) {
    var track = h("div", { class: "pf-scroller", role: "list" });
    items.forEach(function (it, i) {
      var c = postCard(it, coBySlug); c.style.setProperty("--i", i % 8); c.setAttribute("role", "listitem");
      track.appendChild(c);
    });
    var prev = h("button", { class: "pf-arrow pf-arrow--prev", type: "button", "aria-label": "Scroll to previous", html: ICON.chev });
    var next = h("button", { class: "pf-arrow pf-arrow--next", type: "button", "aria-label": "Scroll to next", html: ICON.chev });
    return h("div", { class: "pf-scroller-wrap", "aria-roledescription": "carousel", "aria-label": "Newest portfolio signal — auto-scrolls; pauses on hover or focus" }, prev, track, next);
  }
  function wireScroller(wrap) {
    if (wrap.__wired) return; wrap.__wired = true;
    var track = wrap.querySelector(".pf-scroller"); if (!track) return;
    var prev = wrap.querySelector(".pf-arrow--prev"), next = wrap.querySelector(".pf-arrow--next");
    function step() { var card = track.querySelector(".pf-pcard"); return card ? card.getBoundingClientRect().width + 18 : 318; }
    function go(dir) { track.scrollBy({ left: dir * step(), behavior: "smooth" }); }
    if (prev) prev.addEventListener("click", function () { go(-1); });
    if (next) next.addEventListener("click", function () { go(1); });
    var raf = 0;
    function update() {
      raf = 0;
      var r = track.getBoundingClientRect(), cx = r.left + r.width / 2, best = null, bd = 1e9;
      track.querySelectorAll(".pf-pcard").forEach(function (c) { var cr = c.getBoundingClientRect(); var d = Math.abs((cr.left + cr.width / 2) - cx); if (d < bd) { bd = d; best = c; } });
      track.querySelectorAll(".pf-pcard.is-focus").forEach(function (c) { if (c !== best) c.classList.remove("is-focus"); });
      if (best) best.classList.add("is-focus");
      if (prev) prev.disabled = track.scrollLeft <= 2;
      if (next) next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
    }
    function onScroll() { if (!raf) raf = requestAnimationFrame(update); }
    track.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    update();
    if (RM()) return;
    var paused = false, offscreen = false, timer = null;
    function tick() {
      if (paused || offscreen) return;
      var atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
      if (atEnd) track.scrollTo({ left: 0, behavior: "smooth" }); else go(1);
    }
    function start() { stop(); timer = setInterval(tick, 4600); }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    wrap.addEventListener("pointerenter", function () { paused = true; });
    wrap.addEventListener("pointerleave", function () { paused = false; });
    wrap.addEventListener("focusin", function () { paused = true; });
    wrap.addEventListener("focusout", function () { paused = false; });
    document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else start(); });
    if (window.IntersectionObserver) { var vis = new IntersectionObserver(function (es) { offscreen = !es[0].isIntersecting; }, { threshold: 0 }); vis.observe(wrap); }
    start();
  }

  /* subtle 3D tilt toward the cursor (mirrors hero-cube.js easing) */
  function bindTilt(el) {
    if (el.__tilt || RM() || matchMedia("(hover: none)").matches) return; el.__tilt = true;
    var rx = 0, ry = 0, tx = 0, ty = 0, raf = 0, active = false, MAX = 7;
    function frame() {
      raf = 0; rx += (tx - rx) * 0.18; ry += (ty - ry) * 0.18;
      if (active) { el.style.transform = "perspective(900px) rotateX(" + rx.toFixed(2) + "deg) rotateY(" + ry.toFixed(2) + "deg) scale(1.02)"; }
      else if (Math.abs(rx) > 0.05 || Math.abs(ry) > 0.05) { el.style.transform = "perspective(900px) rotateX(" + rx.toFixed(2) + "deg) rotateY(" + ry.toFixed(2) + "deg)"; }
      else { el.style.transform = ""; return; }
      raf = requestAnimationFrame(frame);
    }
    el.addEventListener("pointermove", function (e) {
      var r = el.getBoundingClientRect();
      ty = ((e.clientX - r.left) / r.width - 0.5) * 2 * MAX;
      tx = -((e.clientY - r.top) / r.height - 0.5) * 2 * MAX;
      active = true; if (!raf) raf = requestAnimationFrame(frame);
    });
    el.addEventListener("pointerleave", function () { tx = 0; ty = 0; active = false; if (!raf) raf = requestAnimationFrame(frame); });
  }

  function jget(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status + " " + u); return r.json(); }); }
  function wordmark() {
    fetch(BASE + "assets/img/bw-wordmark.svg").then(function (r) { return r.ok ? r.text() : ""; }).then(function (t) {
      if (t.indexOf("<svg") >= 0) document.querySelectorAll(".bw-mark").forEach(function (m) { m.innerHTML = t; });
    }).catch(function () {});
  }

  /* ---------- river / index page ---------- */
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

      // per-company aggregates (feed is newest-first: first seen per slug = latest)
      var counts = {}, latestByCo = {};
      feed.forEach(function (it) { counts[it.company_slug] = (counts[it.company_slug] || 0) + 1; if (!latestByCo[it.company_slug]) latestByCo[it.company_slug] = it; });

      // newest-signal scroller (glass + 3D tilt focus)
      var mount = document.getElementById("pf-river-feed"); mount.textContent = "";
      if (!feed.length) mount.appendChild(h("div", { class: "pf-empty" }, "No updates yet."));
      else mount.appendChild(postScroller(feed.slice(0, 16), coBySlug));

      // company bento (live first, then alpha) + sector filter
      var sorted = reg.slice().sort(function (a, b) {
        var da = isDead(a.status) ? 1 : 0, db = isDead(b.status) ? 1 : 0;
        if (da !== db) return da - db; return (a.name || "").localeCompare(b.name || "");
      });
      buildSectorFilter(reg);
      companyBento(sorted, counts, latestByCo);

      // full feed ("All updates")
      var upd = document.getElementById("pf-updates-feed");
      if (upd) {
        upd.textContent = "";
        if (!feed.length) upd.appendChild(h("div", { class: "pf-empty" }, "No updates yet."));
        else { var f = frag(); feed.forEach(function (it) { f.appendChild(itemCard(it, coBySlug)); }); upd.appendChild(f); }
      }

      wirePremium();
    }).catch(function (e) { showError("pf-river-feed", e); });
  }

  /* spotlight = the most-active live companies get larger blocks with a latest-post peek */
  function companyBento(list, counts, latestByCo) {
    var grid = document.getElementById("pf-companies-grid"); if (!grid) return;
    grid.className = "pf-bento"; grid.textContent = "";
    var spot = list.filter(function (c) { return !isDead(c.status) && (counts[c.slug] || 0) > 0; })
      .sort(function (a, b) { return (counts[b.slug] || 0) - (counts[a.slug] || 0); })
      .slice(0, 3).map(function (c) { return c.slug; });
    var isSpot = {}; spot.forEach(function (s) { isSpot[s] = 1; });
    // spotlights anchor the top (largest first), then the rest keep the live-first/alpha order
    var ordered = list.filter(function (c) { return isSpot[c.slug]; })
      .sort(function (a, b) { return (counts[b.slug] || 0) - (counts[a.slug] || 0); })
      .concat(list.filter(function (c) { return !isSpot[c.slug]; }));
    var f = frag();
    ordered.forEach(function (c, i) {
      var block = bentoBlock(c, counts[c.slug] || 0, latestByCo[c.slug], !!isSpot[c.slug]);
      block.classList.add("reveal"); block.style.setProperty("--i", i % 10);
      f.appendChild(block);
    });
    grid.appendChild(f);
  }
  function bentoBlock(c, n, latest, spotlight) {
    var head = h("div", { class: "pf-block__head" },
      h("span", { class: "pf-block__logo-wrap" }, logoEl(c, "pf-block__logo", "pf-block__mono")),
      h("div", { class: "pf-block__id" },
        h("div", { class: "pf-block__name" }, c.name),
        h("div", { class: "pf-block__sector" }, c.sector || "")));
    var peek = (spotlight && latest) ? h("div", { class: "pf-block__peek" },
      h("span", { class: "pf-block__peek-label eyebrow" }, "Latest"),
      h("div", { class: "pf-block__peek-title" }, latest.title || ""),
      h("div", { class: "pf-block__peek-meta" }, (latest.publisher || "") + (relTime(latest.date_published) ? " · " + relTime(latest.date_published) : ""))) : null;
    var desc = (!spotlight && c.description) ? h("div", { class: "pf-block__desc" }, c.description) : null;
    var foot = h("div", { class: "pf-block__foot" }, statusBadge(c.status),
      h("span", { class: "pf-block__count" }, n ? (n + (n === 1 ? " update" : " updates")) : "—"));
    var el = h("a", {
      class: "pf-block" + (spotlight ? " pf-block--spotlight" : "") + (isDead(c.status) ? " is-dead" : ""),
      href: "company.html?slug=" + encodeURIComponent(c.slug), "data-sector": c.sector || "", "data-tilt": "",
      "aria-label": c.name + (c.sector ? " — " + c.sector : "")
    }, h("div", { class: "pf-block__bg", "aria-hidden": "true" }), head, peek, desc, foot);
    el.style.setProperty("--pf-hue", pfHue(c.slug));
    return el;
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
        document.querySelectorAll("#pf-companies-grid .pf-block").forEach(function (card) {
          card.style.display = (s === "All" || card.getAttribute("data-sector") === s) ? "" : "none";
        });
      });
      host.appendChild(btn);
    });
  }

  /* ---------- company drill-down ---------- */
  function computeStats(items) {
    var s = { count: items.length, latest: null, bull: 0, bear: 0, neu: 0, funding: 0, news: 0, blog: 0 };
    items.forEach(function (it) {
      var t = Date.parse(it.date_published); if (!isNaN(t) && (!s.latest || t > s.latest)) s.latest = t;
      if (it.sentiment === "bullish") s.bull++; else if (it.sentiment === "bearish") s.bear++; else s.neu++;
      if (isFunding(it)) s.funding++;
      if (it.source_type === "news") s.news++; else s.blog++;
    });
    return s;
  }
  function statEl(value, label) { return h("span", { class: "pf-hero__stat" }, h("b", null, value), " " + label); }
  function companyHero(c, stats) {
    var eyebrow = h("div", { class: "hero__eyebrow eyebrow" },
      h("span", { class: "chip accent" }, c.sector || "Portfolio"), statusBadge(c.status));
    var links = h("div", { class: "pf-company-links" });
    if (c.website) links.appendChild(h("a", { class: "pf-link pf-link--primary", href: c.website, target: "_blank", rel: "noopener", html: "Website " + ICON.ext }));
    if (c.linkedin_url) links.appendChild(h("a", { class: "pf-link", href: c.linkedin_url, target: "_blank", rel: "noopener", html: ICON.linkedin + " LinkedIn" }));
    var stats_row = h("div", { class: "pf-hero__stats" }, statEl(String(stats.count), stats.count === 1 ? "update" : "updates"));
    if (stats.latest) stats_row.appendChild(statEl(fmtDate(new Date(stats.latest).toISOString()), "latest"));
    if (stats.bull || stats.bear) stats_row.appendChild(h("span", { class: "pf-hero__stat" },
      h("b", null, h("span", { style: "color:var(--up)" }, "▲" + stats.bull), " ", h("span", { style: "color:var(--down)" }, "▼" + stats.bear)), " sentiment"));
    if (stats.funding) stats_row.appendChild(statEl(String(stats.funding), stats.funding === 1 ? "funding event" : "funding events"));
    var card = h("div", { class: "hero__card" },
      eyebrow,
      h("div", { class: "hero__rule", id: "pf-hero-rule" }),
      h("h1", { class: "hero__title" }, c.name),
      c.description ? h("p", { class: "hero__tldr" }, c.description) : null,
      (c.website || c.linkedin_url) ? links : null,
      stats_row);
    var sec = h("section", { class: "pf-hero pf-chero hero reveal" },
      h("div", { class: "hero__bg is-fallback", "aria-hidden": "true" }), h("div", { class: "hero__scrim", "aria-hidden": "true" }),
      h("div", { class: "pf-chero__inner" }, h("div", { class: "pf-chero__logo" }, logoEl(c, "pf-chero__logo-img", "pf-chero__logo-mono")), card));
    sec.style.setProperty("--pf-hue", pfHue(c.slug));
    return sec;
  }
  function postMasonry(items, coBySlug) {
    var m = h("div", { class: "pf-masonry" });
    items.forEach(function (it, i) { var c = postCard(it, coBySlug); c.classList.add("reveal"); c.style.setProperty("--i", i % 8); m.appendChild(c); });
    return m;
  }
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
        var stats = computeStats(hist);

        root.textContent = "";
        root.appendChild(h("a", { class: "pf-back", href: "index.html", html: ICON.back + " All portfolio" }));
        root.appendChild(companyHero(c, stats));

        if (!hist.length) {
          root.appendChild(h("div", { class: "pf-empty" }, "No updates collected yet for " + c.name + "."));
        } else {
          root.appendChild(h("div", { class: "pf-section reveal" },
            h("div", { class: "pf-section-head" }, h("h2", null, "Latest"), h("span", { class: "pf-eyebrow" }, stats.latest ? fmtDate(new Date(stats.latest).toISOString()) : "")),
            postCard(hist[0], coBySlug, true)));
          if (hist.length > 1) {
            root.appendChild(h("div", { class: "pf-section reveal" },
              h("div", { class: "pf-section-head" }, h("h2", null, "Update history"), h("span", { class: "pf-eyebrow" }, (hist.length - 1) + " more")),
              postMasonry(hist.slice(1), coBySlug)));
          }
        }
        wirePremium();
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
    if (window.IntersectionObserver && !RM()) {
      var io = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("in-view"); io.unobserve(en.target); } }); }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
      document.querySelectorAll(".reveal:not(.in-view)").forEach(function (el) { io.observe(el); });
    } else { document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in-view"); }); }
  }
  /* wire the dynamically-rendered premium surfaces (idempotent) */
  function wirePremium() {
    heroSpark();
    document.querySelectorAll(".pf-scroller-wrap").forEach(wireScroller);
    document.querySelectorAll("[data-tilt]").forEach(bindTilt);
    revealWire();
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
