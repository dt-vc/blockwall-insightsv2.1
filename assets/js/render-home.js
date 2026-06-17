/* Blockwall — Homepage renderer (Signal Desk system). XSS-safe. */
(function () {
  "use strict";
  document.documentElement.classList.add("dir-d");

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
  function pickImg(o) { return o ? safeUrl(o.image_url) : null; }
  function fmtDate(id) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(id || ""); return m ? m[2] + "." + m[3] + "." + m[1].slice(2) : (id || ""); }
  var ICON = { moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>' };

  function fallbackCover(source) { return h("div", { class: "fallback-cover" }, h("span", null, initial(source))); }
  function imageBlock(src, sizeCls, source) {
    var cls = "img-glass" + (sizeCls ? " " + sizeCls : "");
    if (!src) return h("div", { class: cls }, fallbackCover(source));
    var wrap = h("div", { class: cls }), img = h("img", { src: src, alt: "", loading: "lazy", decoding: "async" });
    img.addEventListener("error", function () { wrap.innerHTML = ""; wrap.appendChild(fallbackCover(source)); });
    wrap.appendChild(img); return wrap;
  }

  function masthead(no, date) {
    function seg(n, href) { return h("a", { href: href }, n); }
    function sub(label, href) { return h("a", { href: href }, label); }
    return h("header", { class: "masthead is-stuck", id: "masthead" },
      h("div", { class: "wrap masthead-inner" },
        h("a", { class: "wordmark", href: "index.html", style: "color:inherit" }, window.BWBrand ? window.BWBrand.mark() : "Blockwall"),
        h("nav", { class: "cadence-switch", "aria-label": "Cadence" }, seg("Daily", "daily.html"), seg("Weekly", "weekly.html"), seg("Monthly", "monthly.html")),
        h("span", { class: "nav-spacer" }),
        h("span", { class: "dateline eyebrow num" }, "Daily · No. " + (no || "—") + " · " + date),
        h("div", { class: "nav-actions" }, h("a", { href: "archive.html" }, "Archive"),
          h("a", { href: "saved.html" }, "Saved", h("span", { class: "count-badge", id: "saved-count" }, "0")),
          h("button", { class: "icon-btn", "aria-label": "Theme", html: ICON.moon }))),
      h("div", { class: "wrap" }, h("nav", { class: "subnav", "aria-label": "Sections" },
        sub("Latest", "#latest"), sub("Editions", "#editions"), sub("Cadence", "#cadence"), sub("Substack", "#substack"))));
  }

  function brushDash() {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 120 34"); s.setAttribute("class", "brush-dash"); s.setAttribute("aria-hidden", "true"); s.setAttribute("focusable", "false");
    s.style.cssText = "display:inline-block;width:.92em;height:.34em;vertical-align:.1em;margin:0 .08em;transform:rotate(-4deg)";
    s.innerHTML = '<path fill="currentColor" d="M3 22 C 26 13, 52 11, 78 13 C 95 14, 108 16, 117 13 C 110 17, 96 20, 79 20 C 53 21, 27 22, 5 27 C 3.6 27.3 2.4 26.6 2.2 25.2 C 2 24 2 23 3 22 Z"/>';
    return s;
  }
  function hero(daily, no) {
    var heroSrc = pickImg(daily.top_signals && daily.top_signals[0]);
    var bg = heroSrc ? h("div", { class: "hero__bg", style: "background-image:url('" + heroSrc + "')" }) : h("div", { class: "hero__bg is-fallback" });
    return h("section", { class: "hero home-hero reveal", id: "latest" }, bg, h("div", { class: "hero__scrim" }),
      h("div", { class: "hero3d-stage", id: "hero3d", "aria-hidden": "true" }),
      h("div", { class: "hero__card" },
        h("div", { class: "hero__eyebrow eyebrow" }, h("span", { class: "chip accent" }, "Daily"), no ? h("span", { class: "num" }, "No. " + no) : null, h("span", { class: "num" }, fmtDate(daily.id))),
        h("h1", { class: "hero__title reveal reveal--blur" }, "The signal in crypto ", brushDash(), " filtered, dated, daily.", h("span", { class: "sr-only" }, "—")),
        h("p", { class: "hero__tldr" }, "Blockwall's markets desk, distilled into a daily, weekly, and monthly edition for builders and investors.")));
  }
  function liveTape(ed) {
    var ms = ed.market_snapshot; if (!ms || !ms.items) return null;
    var win = ed.type === "weekly" ? "7d" : ed.type === "monthly" ? "30d" : "24h";
    function cell(it) {
      var raw = it.change_24h == null ? "" : String(it.change_24h), numeric = /[0-9]/.test(raw);
      var dir = numeric ? (it.direction || (/^-/.test(raw) ? "down" : "up")) : "flat", g = dir === "up" ? "▲" : dir === "down" ? "▼" : "–";
      return h("span", { class: "lt-cell" }, h("span", { class: "lt-dot" }), h("span", { class: "lt-label" }, it.label), h("span", { class: "lt-price num" }, it.value == null ? "—" : it.value), h("span", { class: "lt-delta " + dir + " num" }, g + " " + (numeric ? raw : "N/A")));
    }
    return h("section", { class: "livetape", "aria-label": "Live market tape" }, h("div", { class: "livetape-track" }, ms.items.map(cell), ms.items.map(cell)));
  }

  function tape(ed) {
    var ms = ed.market_snapshot; if (!ms || !ms.items) return null;
    var cells = ms.items.map(function (it) {
      var raw = it.change_24h == null ? "" : String(it.change_24h), numeric = /[0-9]/.test(raw);
      var dir = numeric ? (it.direction || (/^-/.test(raw) ? "down" : "up")) : "flat", g = dir === "up" ? "▲" : dir === "down" ? "▼" : "–";
      return h("div", { class: "tape-cell", role: "group", "aria-label": it.label }, h("span", { class: "tape-label eyebrow" }, it.label), h("span", { class: "tape-price num" }, it.value == null ? "—" : it.value),
        h("div", null, h("span", { class: "delta " + dir }, h("span", { class: "g" }, g), numeric ? raw : "N/A", h("span", { class: "win" }, "24h"))));
    });
    return h("section", { class: "blk reveal", id: "tape" }, h("div", { class: "wrap" }, h("div", { class: "blk-head" }, h("span", { class: "blk-num num" }, "01"), h("h2", { class: "blk-title" }, "The Tape")),
      h("div", { class: "tape" }, cells)));
  }

  function feature(daily, no) {
    var L = daily.lead || {}, featSrc = pickImg(daily.top_signals && daily.top_signals[0]);
    var media = featSrc ? h("img", { src: featSrc, alt: "" }) : h("div", { class: "fallback-cover" }, h("span", null, "B"));
    if (featSrc) media.addEventListener("error", function () { var a = media.parentNode; if (a) { media.remove(); a.appendChild(h("div", { class: "fallback-cover" }, h("span", null, "B"))); } });
    var cats = {}, tags = []; (daily.top_signals || []).forEach(function (s) { if (s.category && !cats[s.category] && tags.length < 3) { cats[s.category] = 1; tags.push(s.category); } });
    return h("section", { class: "blk reveal", id: "featured" }, h("div", { class: "wrap home-feature" },
      h("a", { href: "daily.html", class: "home-feature__media img-glass", "aria-label": "Read the latest daily" }, media),
      h("div", { class: "home-feature__body" }, h("span", { class: "eyebrow", style: "color:var(--accent-link)" }, "Latest · Daily · " + fmtDate(daily.id)),
        h("h2", null, L.headline || ""), h("p", { class: "secondary" }, L.tldr || ""),
        h("div", { class: "home-feature__tags" }, tags.map(function (t) { return h("span", { class: "chip" }, t); })),
        h("a", { class: "uline", href: "daily.html", style: "color:var(--accent-link);font-weight:600" }, "Read the edition →"))));
  }

  function editionCard(e, i) {
    return h("a", { class: "home-card reveal", href: e.page + (e.id ? "?id=" + encodeURIComponent(e.id) : ""), style: "--i:" + (i % 6) },
      imageBlock(safeUrl(e.thumbnail), "home-card__media", e.title),
      h("div", { class: "home-card__body" }, h("div", { class: "home-card__meta" }, (e.type || "daily").toUpperCase() + " · " + (e.date_display || "")),
        h("div", { class: "home-card__title" }, e.title || ""), e.snippet ? h("div", { class: "home-card__snip" }, e.snippet) : null));
  }
  function editions(dailyMan, weekly, monthly, featuredId) {
    var list = [];
    (dailyMan || []).filter(function (m) { return m.id !== featuredId; }).slice(0, 5).forEach(function (m) { list.push({ type: "daily", id: m.id, title: m.title, snippet: m.snippet, date_display: m.date_display, thumbnail: m.thumbnail, page: "daily.html" }); });
    if (weekly) list.push({ type: "weekly", id: weekly.id, title: (weekly.lead || {}).headline, snippet: (weekly.lead || {}).tldr, date_display: weekly.date_display, thumbnail: pickImg(weekly.top_signals && weekly.top_signals[0]), page: "weekly.html" });
    if (monthly) list.push({ type: "monthly", id: monthly.id, title: (monthly.lead || {}).headline || ("Blockwall — " + (monthly.date_display || "")), snippet: (monthly.lead || {}).tldr || monthly.intro, date_display: monthly.date_display, thumbnail: pickImg(monthly.top_signals && monthly.top_signals[0]), page: "monthly.html" });
    return h("section", { class: "blk reveal", id: "editions" }, h("div", { class: "wrap" }, h("div", { class: "blk-head" }, h("span", { class: "blk-num num" }, "02"), h("h2", { class: "blk-title" }, "Recent editions")),
      h("div", { class: "home-editions" }, list.map(function (e, i) { return editionCard(e, i); }))));
  }

  function cadence(dN, wN, mN) {
    function tile(idx, n, count, blurb, href) { return h("a", { class: "home-tile reveal", href: href, style: "display:block;color:inherit;text-decoration:none" },
      h("span", { class: "blk-num num" }, idx), h("h3", null, n),
      h("span", { class: "num home-tile__count" }, count + (count === 1 ? " edition" : " editions")),
      h("p", null, blurb), h("span", { class: "uline", style: "color:var(--accent-link);font-weight:600" }, "Browse →")); }
    return h("section", { class: "blk reveal", id: "cadence" }, h("div", { class: "wrap" }, h("div", { class: "blk-head" }, h("span", { class: "blk-num num" }, "03"), h("h2", { class: "blk-title" }, "Explore")),
      h("div", { class: "home-cadence" }, tile("01", "Daily", dN, "The markets pulse — every weekday.", "daily.html"), tile("02", "Weekly", wN, "Themes & what mattered.", "weekly.html"), tile("03", "Monthly", mN, "The deep recap.", "monthly.html")),
      h("div", { class: "home-explore-extra" }, h("a", { class: "chip", href: "archive.html" }, "Archive"), h("a", { class: "chip", href: "saved.html" }, "Saved shortlist"))));
  }

  function substack(posts) {
    posts = (posts || []).filter(function (p) { return p && p.title; }); if (!posts.length) return null;
    function card(p) { var url = safeUrl(p.url || p.link), im = p.image || p.img;
      return h("a", { class: "ss-card", href: url || "#", target: url ? "_blank" : null, rel: "noopener" },
        h("div", { class: "ss-card__img" }, im ? h("img", { src: im, alt: "", loading: "lazy" }) : h("div", { style: "width:100%;height:100%;background:linear-gradient(135deg,#1b2433,#0b0d10)" })),
        h("div", { class: "ss-card__body" }, h("div", { class: "ss-card__title" }, p.title), h("div", { class: "ss-card__meta" }, (p.author ? p.author + " · " : "") + "Substack"))); }
    var cards = posts.map(card), clones = posts.map(card); clones.forEach(function (c) { c.setAttribute("aria-hidden", "true"); c.setAttribute("tabindex", "-1"); });
    return h("section", { class: "substack bleed reveal", id: "substack" }, h("div", { class: "wrap substack__head" }, h("span", { class: "blk-num num" }, "04"), h("h2", { class: "blk-title" }, "From the Blockwall Substack")),
      h("div", { class: "substack-marquee", "aria-label": "Blockwall Substack posts" }, h("div", { class: "substack-marquee__track" }, cards, clones)));
  }

  function subscribe() {
    var note = h("div", { class: "home-sub-note" });
    var form = h("form", { class: "home-sub-form" }, h("input", { type: "email", placeholder: "you@fund.com", "aria-label": "Email", required: true }), h("button", { class: "cta", type: "submit" }, "Subscribe"));
    form.addEventListener("submit", function (e) { e.preventDefault(); note.textContent = "You're on the list (demo)."; });
    return h("section", { class: "blk reveal", id: "subscribe" }, h("div", { class: "wrap" }, h("div", { class: "home-subscribe" },
      h("h2", null, "Join builders & investors reading Blockwall."), h("p", null, "No spam. Unsubscribe anytime."), form,
      h("div", { class: "home-sub-cadence" }, h("span", { class: "chip" }, "Daily"), h("span", { class: "chip" }, "Weekly"), h("span", { class: "chip" }, "Monthly")), note)));
  }

  function footer() {
    function col(t, ls) { return h("div", null, h("h4", null, t), h("ul", null, ls.map(function (l) { return h("li", null, h("a", { href: "#" }, l)); }))); }
    return h("footer", { class: "foot" }, h("div", { class: "wrap foot-grid" },
      h("div", { class: "foot-brand" }, h("span", { class: "wordmark" }, h("span", { class: "dot" }), "Blockwall"), h("p", null, "Markets intelligence for crypto builders and investors. European Crypto Venture Capital · Frankfurt.")),
      col("Editions", ["Daily", "Weekly", "Monthly", "Archive"]), col("Categories", ["DeFi", "Macro", "Regulation", "Funding"]), col("Blockwall", ["About", "Subscribe", "Substack"])));
  }

  function wire() {
    if (window.SaveStore) { var sync = function () { var el = document.getElementById("saved-count"); if (el) { var c = window.SaveStore.count(); el.textContent = String(c); el.style.display = c ? "" : "none"; } }; window.SaveStore.subscribe(sync); sync(); window.SaveStore.ensureLoaded().then(sync); }
    var mh = document.getElementById("masthead"), prog = document.getElementById("scroll-progress");
    function onScroll() { if (mh) mh.classList.toggle("is-stuck", true); if (prog) { var sc = document.documentElement.scrollHeight - window.innerHeight; prog.style.width = (sc > 0 ? window.scrollY / sc * 100 : 0) + "%"; } }
    window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
    document.querySelectorAll('.subnav a[href^="#"], .cadence-switch a[href^="#"]').forEach(function (a) { a.addEventListener("click", function (e) { var href = a.getAttribute("href"); var t = href && href.length > 1 && document.querySelector(href); if (t) { e.preventDefault(); if (window.__lenis) window.__lenis.scrollTo(t, { offset: -70 }); else t.scrollIntoView({ behavior: "smooth", block: "start" }); } }); });
    if (window.IntersectionObserver && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      var io = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("in-view"); io.unobserve(en.target); } }); }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
      document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });
    } else { document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in-view"); }); }
    if (matchMedia("(hover:hover) and (pointer:fine)").matches) document.addEventListener("pointermove", function (e) {
      var c = e.target.closest && e.target.closest(".home-card"); if (!c) return; var r = c.getBoundingClientRect();
      c.style.setProperty("--mx", (e.clientX - r.left) + "px"); c.style.setProperty("--my", (e.clientY - r.top) + "px");
    }, { passive: true });
  }

  function jget(u, fb) { return fetch(u).then(function (r) { if (!r.ok) throw 0; return r.json(); }).catch(function () { return fb; }); }
  function build(daily, weekly, monthly, man, wMan, mMan, subs) {
    var app = document.getElementById("app");
    if (!daily) { app.innerHTML = '<p style="padding:48px;color:#f66">Failed to load the latest daily edition.</p>'; return; }
    var dN = man.length, wN = wMan.length, mN = mMan.length, no = man.length;
    app.appendChild(masthead(no, fmtDate(daily.id)));
    var lt = liveTape(daily); if (lt) app.appendChild(lt);
    app.appendChild(h("div", { class: "scroll-progress", id: "scroll-progress" }));
    var main = h("main", null, hero(daily, no), tape(daily), feature(daily, no), editions(man, weekly, monthly, daily.id), cadence(dN, wN, mN), substack(subs));
    app.appendChild(main); app.appendChild(window.BWBrand ? window.BWBrand.footer() : footer()); wire();
    if (window.LiveTape) window.LiveTape.upgrade(daily);
    if (window.HeroCube) window.HeroCube.mount("#hero3d");
  }
  Promise.all([jget("data/daily.json", []), jget("data/weekly.json", []), jget("data/monthly.json", []), jget("data/substack.json", [])])
    .then(function (m) {
      var dMan = Array.isArray(m[0]) ? m[0] : [], wMan = Array.isArray(m[1]) ? m[1] : [], mMan = Array.isArray(m[2]) ? m[2] : [], subs = Array.isArray(m[3]) ? m[3] : [];
      if (!dMan.length) throw new Error("no daily editions");
      var dId = dMan[0].id, wId = wMan[0] && wMan[0].id, mId = mMan[0] && mMan[0].id;
      return Promise.all([
        jget("data/daily/" + dId + ".json", null),
        wId ? jget("data/weekly/" + wId + ".json", null) : Promise.resolve(null),
        mId ? jget("data/monthly/" + mId + ".json", null) : Promise.resolve(null)
      ]).then(function (eds) { build(eds[0], eds[1], eds[2], dMan, wMan, mMan, subs); });
    })
    .catch(function (e) { document.getElementById("app").innerHTML = '<p style="padding:48px;color:#f66">Failed to load: ' + (e && e.message) + "</p>"; });
})();
