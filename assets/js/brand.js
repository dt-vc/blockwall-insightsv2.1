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
  /* Follow icons — inline SVG (currentColor), no third-party badge/script. */
  var SOCIAL = [
    ["Blockwall on X", "https://x.com/blockwall_vc",
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"/></svg>'],
    ["Blockwall on LinkedIn", "https://www.linkedin.com/company/blockwall/posts/?feedView=all",
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286ZM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065Zm1.782 13.019H3.555V9h3.564v11.452ZM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0Z"/></svg>']
  ];
  function social() {
    var s = el("div", "foot-social");
    SOCIAL.forEach(function (it) {
      var a = el("a", "foot-social__link"); a.href = it[1]; a.target = "_blank"; a.rel = "noopener";
      a.setAttribute("aria-label", it[0]); a.title = it[0]; a.innerHTML = it[2];
      s.appendChild(a);
    });
    return s;
  }
  function footer() {
    var f = el("footer", "foot");
    var wrap = el("div", "wrap foot-grid");
    var brand = el("div", "foot-brand");
    var wm = el("a", "wordmark"); wm.href = "index.html"; wm.style.color = "inherit"; wm.appendChild(mark()); brand.appendChild(wm);
    brand.appendChild(el("p", null, "Markets intelligence for crypto builders and investors. European Crypto Venture Capital · Frankfurt."));
    brand.appendChild(social());
    wrap.appendChild(brand);
    wrap.appendChild(col("Editions", [["Daily", "daily.html"], ["Weekly", "weekly.html"], ["Monthly", "monthly.html"], ["Archive", "archive.html"]]));
    wrap.appendChild(col("Browse", [["Home", "index.html"], ["Archive", "archive.html"], ["Saved", "saved.html"]]));
    wrap.appendChild(col("Blockwall", [["Substack", "https://insights.blockwall.vc", 1], ["Website", "https://www.blockwall.vc", 1]]));
    f.appendChild(wrap);
    var big = el("div", "foot-logo"); var bm = el("a", "foot-logo__mark"); bm.href = "index.html"; bm.setAttribute("aria-label", "Blockwall"); bm.appendChild(mark(true)); big.appendChild(bm); f.appendChild(big);
    return f;
  }
  global.BWBrand = { mark: mark, footer: footer };
})(window);
