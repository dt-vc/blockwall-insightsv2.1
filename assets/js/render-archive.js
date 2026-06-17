/* Blockwall — Archive index. XSS-safe. Browses all editions from the 3 manifests. */
(function () {
  "use strict";
  document.documentElement.classList.add("dir-d");
  var Store = window.SaveStore;

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
  var ICON = { moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>' };
  function pageFor(type) { return type === "weekly" ? "weekly.html" : type === "monthly" ? "monthly.html" : "daily.html"; }

  function masthead(counts) {
    function seg(n, href, cur) { return h("a", { href: href, "aria-current": cur ? "page" : null }, n); }
    return h("header", { class: "masthead is-stuck", id: "masthead" }, h("div", { class: "wrap masthead-inner" },
      h("a", { class: "wordmark", href: "index.html", style: "color:inherit" }, window.BWBrand ? window.BWBrand.mark() : "Blockwall"),
      h("nav", { class: "cadence-switch", "aria-label": "Cadence" }, seg("Daily", "daily.html"), seg("Weekly", "weekly.html"), seg("Monthly", "monthly.html")),
      h("span", { class: "nav-spacer" }),
      h("div", { class: "nav-actions" }, h("a", { href: "index.html" }, "Home"), h("a", { href: "archive.html", "aria-current": "page" }, "Archive"),
        h("a", { href: "saved.html" }, "Saved", h("span", { class: "count-badge", id: "saved-count" }, "0")), h("button", { class: "icon-btn", "aria-label": "Theme", html: ICON.moon }))));
  }
  function footer() {
    function col(t, ls) { return h("div", null, h("h4", null, t), h("ul", null, ls.map(function (l) { return h("li", null, h("a", { href: l[1] }, l[0])); }))); }
    return h("footer", { class: "foot" }, h("div", { class: "wrap foot-grid" },
      h("div", { class: "foot-brand" }, h("span", { class: "wordmark" }, h("span", { class: "dot" }), "Blockwall"), h("p", null, "Markets intelligence for crypto builders and investors. European Crypto Venture Capital · Frankfurt.")),
      col("Editions", [["Daily", "daily.html"], ["Weekly", "weekly.html"], ["Monthly", "monthly.html"]]), col("Browse", [["Archive", "archive.html"], ["Saved", "saved.html"], ["Home", "index.html"]]), col("Blockwall", [["About", "#"], ["Subscribe", "#"], ["Substack", "#"]])));
  }

  function row(e) {
    var page = pageFor(e.type) + "?id=" + encodeURIComponent(e.id);
    var thumb;
    if (safeUrl(e.thumbnail)) { var im = h("img", { src: e.thumbnail, alt: "", loading: "lazy" });
      im.addEventListener("error", function () { var p = im.parentNode; if (p) { im.remove(); p.appendChild(h("span", { class: "mono" }, initial(e.title))); } });
      thumb = h("span", { class: "arc-row__thumb" }, im);
    } else thumb = h("span", { class: "arc-row__thumb" }, h("span", { class: "mono" }, initial(e.title)));
    return h("div", { class: "arc-row reveal", "data-id": e.id, "data-cadence": e.type },
      thumb,
      h("div", { class: "arc-row__body" },
        h("div", { class: "arc-row__tags" }, h("span", { class: "chip" }, (e.type || "daily")), e._latest ? h("span", { class: "chip accent" }, "Latest") : null),
        h("a", { class: "arc-row__title", href: page }, e.title || "Untitled edition"),
        e.snippet ? h("p", { class: "arc-row__summary" }, e.snippet) : null,
        h("div", { class: "arc-row__meta eyebrow num" }, (e.date_display || e.id) + (e._no ? " · No. " + e._no : ""))),
      h("div", { class: "arc-row__aside" }, h("span", { class: "num" }, (e.sources || 0) + " sources"),
        h("span", null, h("span", { class: "sent bullish" }, "▲ " + (e.bullish || 0)), " ", h("span", { class: "sent bearish" }, "▼ " + (e.bearish || 0)))));
  }

  function tsOf(id) { var m; id = id || "";
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(id))) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    if ((m = /^(\d{4})-W(\d{2})/.exec(id))) return Date.UTC(+m[1], 0, 1) + (+m[2] - 1) * 7 * 86400000;
    if ((m = /^(\d{4})-(\d{2})$/.exec(id))) return Date.UTC(+m[1], +m[2] - 1, 1);
    return 0; }
  var state = { cadence: "all", query: "", sort: "newest", reveal: 24 };
  var ALL = [];
  function derive() {
    var v = ALL.slice();
    if (state.cadence !== "all") v = v.filter(function (e) { return e.type === state.cadence; });
    if (state.query) { var q = state.query.toLowerCase(); v = v.filter(function (e) { return ((e.title || "") + " " + (e.snippet || "")).toLowerCase().indexOf(q) >= 0; }); }
    if (state.sort === "sources") v.sort(function (a, b) { return (b.sources || 0) - (a.sources || 0); });
    else if (state.sort === "active") v.sort(function (a, b) { return ((b.bullish || 0) + (b.bearish || 0)) - ((a.bullish || 0) + (a.bearish || 0)); });
    else v.sort(function (a, b) { return (b._ts || 0) - (a._ts || 0); });
    return v;
  }
  function renderList() {
    var listEl = document.getElementById("arc-list"), moreWrap = document.getElementById("arc-more");
    var v = derive(); listEl.innerHTML = ""; moreWrap.innerHTML = "";
    var shown = v.slice(0, state.reveal);
    shown.forEach(function (e) { listEl.appendChild(row(e)); });
    var rm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (window.IntersectionObserver && !rm) { var io = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("in-view"); io.unobserve(en.target); } }); }, { threshold: 0.04 }); listEl.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); }); }
    else listEl.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in-view"); });
    if (v.length > state.reveal) { var btn = h("button", { class: "chip archive-more", type: "button" }, "Load 24 more"); var rem = h("span", { class: "archive-count" }, " " + (v.length - state.reveal) + " more"); btn.appendChild(rem);
      btn.addEventListener("click", function () { state.reveal += 24; renderList(); }); moreWrap.appendChild(btn); }
    else if (v.length === 0) moreWrap.appendChild(h("p", { class: "archive-count", style: "text-align:center;padding:40px" }, "No editions match."));
  }

  function toolbar(counts) {
    function tab(label, val, n) { var a = h("a", { href: "#", "aria-current": state.cadence === val ? "page" : null }, label, n != null ? h("span", { class: "count-badge" }, String(n)) : null);
      a.addEventListener("click", function (e) { e.preventDefault(); state.cadence = val; state.reveal = 24; document.querySelectorAll(".arc-tabs a").forEach(function (x) { x.removeAttribute("aria-current"); }); a.setAttribute("aria-current", "page"); renderList(); }); return a; }
    var tabs = h("nav", { class: "cadence-switch arc-tabs", "aria-label": "Filter by cadence" }, tab("All", "all"), tab("Daily", "daily", counts.daily), tab("Weekly", "weekly", counts.weekly), tab("Monthly", "monthly", counts.monthly));
    var search = h("input", { class: "archive-search", type: "search", placeholder: "Search editions…", "aria-label": "Search editions" });
    var t; search.addEventListener("input", function () { clearTimeout(t); t = setTimeout(function () { state.query = search.value.trim(); state.reveal = 24; renderList(); }, 150); });
    function sopt(label, val) { var a = h("a", { href: "#", "aria-current": state.sort === val ? "page" : null }, label);
      a.addEventListener("click", function (e) { e.preventDefault(); state.sort = val; state.reveal = 24; sortNav.querySelectorAll("a").forEach(function (x) { x.removeAttribute("aria-current"); }); a.setAttribute("aria-current", "page"); renderList(); }); return a; }
    var sortNav = h("nav", { class: "cadence-switch", "aria-label": "Sort" }, sopt("Newest", "newest"), sopt("Sources", "sources"), sopt("Active", "active"));
    return h("div", { class: "archive-toolbar" }, h("div", { class: "wrap", style: "display:flex;gap:14px;align-items:center;flex-wrap:wrap;width:100%" }, tabs, h("span", { class: "spacer" }), search, sortNav));
  }

  Promise.all(["data/daily.json", "data/weekly.json", "data/monthly.json"].map(function (u) { return fetch(u).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }); }))
    .then(function (res) {
      ["daily", "weekly", "monthly"].forEach(function (cad, ci) { var arr = Array.isArray(res[ci]) ? res[ci] : []; arr.forEach(function (e, i) { e.type = e.type || cad; e._no = arr.length - i; e._latest = i === 0; e._ts = tsOf(e.id); ALL.push(e); }); });
      var counts = { daily: (res[0] || []).length, weekly: (res[1] || []).length, monthly: (res[2] || []).length };
      var app = document.getElementById("app");
      app.appendChild(masthead(counts));
      var main = h("main", null,
        h("section", { class: "blk", style: "padding-bottom:var(--space-5)" }, h("div", { class: "wrap" }, h("span", { class: "eyebrow", style: "color:var(--accent-link)" }, "Archive"),
          h("h1", { class: "hero__title", style: "font-size:clamp(2rem,3.4vw,2.8rem);margin:10px 0" }, "The back-catalogue"),
          h("p", { class: "measure secondary" }, "Every Blockwall edition — daily, weekly, monthly. Newest first."))),
        toolbar(counts),
        h("div", { class: "wrap archive-list" }, h("div", { id: "arc-list" }), h("div", { id: "arc-more", style: "text-align:center" })));
      app.appendChild(main); app.appendChild(window.BWBrand ? window.BWBrand.footer() : footer());
      renderList();
      if (Store) { var sync = function () { var el = document.getElementById("saved-count"); if (el) { var c = Store.count(); el.textContent = String(c); el.style.display = c ? "" : "none"; } }; Store.subscribe(sync); sync(); Store.ensureLoaded().then(sync); }
      var mh = document.getElementById("masthead"); window.addEventListener("scroll", function () { mh.classList.toggle("is-stuck", true); }, { passive: true });
    });
})();
