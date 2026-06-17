/* Blockwall — Saved/shortlist view. Hydrates from the live n8n curation API
   (GET bw-curated via SaveStore), groups saved rows, shows analyst + note +
   provenance. XSS-safe. Live row keys: item_id, primary_source, cadence,
   edition_id, analyst, title, url, note, theme, saved_at. */
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
  var ICON = { moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>' };
  var CAD_LABEL = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
  function cadOf(row) { var c = row.cadence; if (c) return c; var id = row.edition_id || ""; if (/-W\d/i.test(id)) return "weekly"; if (/^\d{4}-\d{2}$/.test(id)) return "monthly"; return "daily"; }
  function editionPage(row) { var id = row.edition_id; if (!id) return null; return cadOf(row) + ".html?id=" + encodeURIComponent(id); }
  function ago(iso) { return (iso || "").slice(0, 10); }

  function masthead() {
    function seg(n, href) { return h("a", { href: href }, n); }
    return h("header", { class: "masthead is-stuck" }, h("div", { class: "wrap masthead-inner" },
      h("a", { class: "wordmark", href: "index.html", style: "color:inherit" }, window.BWBrand ? window.BWBrand.mark() : "Blockwall"),
      h("nav", { class: "cadence-switch", "aria-label": "Cadence" }, seg("Daily", "daily.html"), seg("Weekly", "weekly.html"), seg("Monthly", "monthly.html")),
      h("span", { class: "nav-spacer" }),
      h("div", { class: "nav-actions" }, h("a", { href: "index.html" }, "Home"), h("a", { href: "archive.html" }, "Archive"),
        h("a", { href: "saved.html", "aria-current": "page" }, "Saved", h("span", { class: "count-badge", id: "saved-count" }, "0")), h("button", { class: "icon-btn", "aria-label": "Theme", html: ICON.moon }))));
  }

  var groupMode = "theme";
  function savedItem(row) {
    var url = safeUrl(row.url), page = editionPage(row), mine = Store && (row.analyst || "") === Store.getAnalyst();
    var title = url ? h("a", { class: "saved-item__title", href: url, target: "_blank", rel: "noopener" }, row.title || "Saved item") : h("span", { class: "saved-item__title" }, row.title || "Saved item");
    var bits = [];
    if (row.analyst) bits.push(h("b", { class: "saved-item__by" }, row.analyst));
    bits.push(h("span", null, (CAD_LABEL[cadOf(row)] || "Daily") + (row.edition_id ? " " + row.edition_id : "")));
    if (row.category) bits.push(h("span", null, row.category));
    if (row.primary_source) bits.push(h("span", null, row.primary_source));
    if (row.saved_at) bits.push(h("span", { class: "num" }, ago(row.saved_at)));
    var meta = []; bits.forEach(function (b, i) { if (i) meta.push(h("span", { class: "sep" }, "·")); meta.push(b); });
    var remove = mine ? h("button", { class: "saved-item__remove", type: "button", "aria-label": "Remove from shortlist" }, "✕") : null;
    var node = h("div", { class: "saved-item", "data-id": row.item_id },
      h("div", { class: "saved-item__main" }, title, h("div", { class: "saved-item__meta" }, meta),
        row.note ? h("p", { class: "saved-item__note" }, row.note) : null,
        page ? h("a", { class: "saved-item__open", href: page }, "Open edition →") : null),
      remove);
    if (remove) remove.addEventListener("click", function () { remove.disabled = true; Store.removeRow(row.edition_id, row.item_id, row.analyst); });
    return node;
  }

  function render() {
    var app = document.getElementById("app-body"); if (!app) return; app.innerHTML = "";
    var items = Store ? Store.all() : [];
    if (!items.length) { app.appendChild(h("div", { class: "saved-empty" }, h("p", null, "Nothing saved yet. Star any signal, radar item or resource — add a note and theme — to build the team shortlist."), h("a", { class: "chip", href: "archive.html" }, "Browse the archive →"))); return; }
    var groups = {}, order = [];
    items.forEach(function (it) { var key = groupMode === "cadence" ? cadOf(it) : groupMode === "edition" ? (it.edition_id || "—") : (it.theme || it.category || "untagged"); if (!groups[key]) { groups[key] = []; order.push(key); } groups[key].push(it); });
    if (groupMode === "cadence") order.sort(function (a, b) { var o = ["daily", "weekly", "monthly"]; return o.indexOf(a) - o.indexOf(b); });
    else if (groupMode === "edition") order.sort(function (a, b) { return a < b ? 1 : -1; });
    else order.sort(function (a, b) { return a < b ? -1 : 1; });
    order.forEach(function (key) {
      var label = groupMode === "cadence" ? (CAD_LABEL[key] || key) : key;
      app.appendChild(h("div", { class: "saved-group" }, h("div", { class: "cat-head" }, h("span", { class: "eyebrow" }, label), h("span", { class: "muted t-caption num" }, groups[key].length + (groups[key].length === 1 ? " item" : " items"))),
        h("div", null, groups[key].map(savedItem))));
    });
  }

  var app = document.getElementById("app");
  app.appendChild(masthead());
  function modeTab(label, val) { var a = h("a", { href: "#", "aria-current": groupMode === val ? "page" : null }, label);
    a.addEventListener("click", function (e) { e.preventDefault(); groupMode = val; document.querySelectorAll(".saved-modes a").forEach(function (x) { x.removeAttribute("aria-current"); }); a.setAttribute("aria-current", "page"); render(); }); return a; }
  var analystInput = h("input", { class: "curate-input saved-analyst", type: "text", placeholder: "Your name", value: (Store && Store.getAnalyst()) || "", maxlength: "40", "aria-label": "Analyst name" });
  analystInput.addEventListener("change", function () { if (Store) Store.setAnalyst(analystInput.value); });
  app.appendChild(h("main", null,
    h("section", { class: "blk", style: "padding-bottom:var(--space-4)" }, h("div", { class: "wrap" },
      h("span", { class: "eyebrow", style: "color:var(--accent-link)" }, "★ Shortlist"),
      h("h1", { class: "hero__title", style: "font-size:clamp(2rem,3.4vw,2.8rem);margin:10px 0" }, "Saved signals"),
      h("p", { class: "measure secondary" }, "Everything the team has starred — across daily, weekly, and monthly editions, with the analyst and notes."),
      h("div", { class: "saved-controls" },
        h("label", { class: "saved-analyst-wrap" }, h("span", { class: "muted" }, "Analyst"), analystInput),
        h("div", { class: "saved-modes cadence-switch", "aria-label": "Group by" }, modeTab("By theme", "theme"), modeTab("By cadence", "cadence"), modeTab("By edition", "edition"))))),
    h("div", { class: "wrap", id: "app-body" }, h("div", { class: "saved-empty" }, h("p", null, "Loading the shortlist…")))));
  if (window.BWBrand) app.appendChild(window.BWBrand.footer());

  function sync() { var el = document.getElementById("saved-count"); if (el && Store) { var c = Store.count(); el.textContent = String(c); el.style.display = c ? "" : "none"; } }
  if (Store) {
    Store.subscribe(function () { sync(); render(); });
    Store.refresh().then(function () { sync(); render(); }, function () {
      var app2 = document.getElementById("app-body"); if (app2) { app2.innerHTML = ""; app2.appendChild(h("div", { class: "saved-empty" }, h("p", null, "Could not reach the curation service. Refresh to retry."), h("a", { class: "chip", href: "saved.html" }, "Retry"))); }
    });
  }
})();
