/* Blockwall — tiny dependency-free inline SVG sparkline generator.
   window.BWSpark.svg(values, opts) -> SVG string (XSS-safe; only numbers reach the path).
   opts: {w,h,min,max,baseline,label}. Colored by direction via var(--up|--down|--flat). */
(function (g) {
  "use strict";
  function esc(s) { return String(s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }
  function path(vals, o) {
    o = o || {}; var W = o.w || 64, H = o.h || 18, n = vals.length;
    var min = o.min != null ? o.min : Math.min.apply(null, vals), max = o.max != null ? o.max : Math.max.apply(null, vals);
    var range = (max - min) || 0;
    if (range === 0) { var mid = (H / 2).toFixed(1); return { d: "M0 " + mid + " L" + W + " " + mid, dir: "flat", lx: W, ly: H / 2, w: W, h: H }; }
    var X = function (i) { return i * (W / (n - 1)); }, Y = function (v) { return H - ((v - min) / range) * H; };
    var d = vals.map(function (v, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); }).join(" ");
    var first = vals[0], last = vals[n - 1];
    return { d: d, dir: last > first ? "up" : last < first ? "down" : "flat", lx: X(n - 1), ly: Y(last), w: W, h: H };
  }
  function svg(vals, o) {
    o = o || {}; if (!vals || vals.length < 2) return "";
    var p = path(vals, o), id = "sp" + (svg._n = (svg._n || 0) + 1);
    var base = "";
    if (o.baseline != null) {
      var bmin = o.min != null ? o.min : 0, bmax = o.max != null ? o.max : 100, brange = (bmax - bmin) || 1;
      var by = (p.h - ((o.baseline - bmin) / brange) * p.h).toFixed(1);
      base = '<line x1="0" y1="' + by + '" x2="' + p.w + '" y2="' + by + '" stroke="var(--border-strong)" stroke-width="0.5" vector-effect="non-scaling-stroke"/>';
    }
    var lab = o.label ? ' role="img" aria-labelledby="' + id + '"' : ' aria-hidden="true"';
    var title = o.label ? '<title id="' + id + '">' + esc(o.label) + "</title>" : "";
    return '<svg viewBox="0 0 ' + p.w + " " + p.h + '" class="spark spark--' + p.dir + '" preserveAspectRatio="none"' + lab + ">" + title + base
      + '<path d="' + p.d + '" fill="none" stroke="var(--' + p.dir + ')" stroke-width="1.4" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" pathLength="1"/>'
      + '<circle cx="' + p.lx.toFixed(1) + '" cy="' + p.ly.toFixed(1) + '" r="1.8" fill="var(--' + p.dir + ')"/></svg>';
  }
  g.BWSpark = { path: path, svg: svg };
})(window);
