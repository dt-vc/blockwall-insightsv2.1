/* Blockwall brand — injects the real wordmark SVG (currentColor, themes) into
   every .bw-mark, and builds the shared footer (working links + big logo).
   window.BWBrand.mark(big) / .footer(). Loads before the renderers. */
(function (global) {
  "use strict";
  var svg = null, marks = [];
  fetch("assets/img/bw-wordmark.svg").then(function (r) { return r.ok ? r.text() : ""; }).then(function (t) {
    if (t.indexOf("<svg") >= 0) { svg = t; marks.forEach(function (m) { m.innerHTML = svg; }); }
  }).catch(function () {});

  function mark(big) {
    var s = document.createElement("span"); s.className = "bw-mark" + (big ? " bw-mark--big" : "");
    s.textContent = "Blockwall"; marks.push(s); if (svg) s.innerHTML = svg; return s;
  }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function col(title, links) {
    var d = el("div"); d.appendChild(el("h4", null, title)); var ul = el("ul");
    links.forEach(function (l) { var li = el("li"); var a = el("a", null, l[0]); a.href = l[1]; if (l[2]) { a.target = "_blank"; a.rel = "noopener"; } li.appendChild(a); ul.appendChild(li); });
    d.appendChild(ul); return d;
  }
  function footer() {
    var f = el("footer", "foot");
    var wrap = el("div", "wrap foot-grid");
    var brand = el("div", "foot-brand");
    var wm = el("a", "wordmark"); wm.href = "index.html"; wm.style.color = "inherit"; wm.appendChild(mark()); brand.appendChild(wm);
    brand.appendChild(el("p", null, "Markets intelligence for crypto builders and investors. European Crypto Venture Capital · Frankfurt."));
    wrap.appendChild(brand);
    wrap.appendChild(col("Editions", [["Daily", "daily.html"], ["Weekly", "weekly.html"], ["Monthly", "monthly.html"], ["Archive", "archive.html"]]));
    wrap.appendChild(col("Browse", [["Home", "index.html"], ["Archive", "archive.html"], ["Saved", "saved.html"], ["Portfolio", "portfolio/index.html"]]));
    wrap.appendChild(col("Blockwall", [["Substack", "https://insights.blockwall.vc", 1], ["Website", "https://www.blockwall.vc", 1], ["Knowledge Hub", "https://dt-vc.github.io/blockwall-kg-hub/", 1]]));
    f.appendChild(wrap);
    var big = el("div", "foot-logo"); var bm = el("a", "foot-logo__mark"); bm.href = "index.html"; bm.setAttribute("aria-label", "Blockwall"); bm.appendChild(mark(true)); big.appendChild(bm); f.appendChild(big);
    return f;
  }
  global.BWBrand = { mark: mark, footer: footer };
})(window);
