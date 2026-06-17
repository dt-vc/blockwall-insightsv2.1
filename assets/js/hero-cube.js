/* Blockwall hero "block" — a CSS-3D glass cube: the real wordmark on the front,
   the ecosystem (Web3 / DeFi / Crypto / RWA / Stables) on the other faces.
   Works everywhere (no WebGL), crisp text, themes via CSS vars. window.HeroCube.mount(sel). */
(function () {
  "use strict";
  var FACES = [
    { cls: "cube-front", logo: true },
    { cls: "cube-back", t: "Web3" },
    { cls: "cube-right", t: "DeFi" },
    { cls: "cube-left", t: "Crypto" },
    { cls: "cube-top", t: "RWA" },
    { cls: "cube-bottom", t: "Stables" }
  ];
  function build(stage) {
    var scene = document.createElement("div"); scene.className = "cube-scene";
    var cube = document.createElement("div"); cube.className = "cube";
    FACES.forEach(function (f) {
      var d = document.createElement("div"); d.className = "cube-face " + f.cls;
      if (f.logo) {
        var wm = document.createElement("span"); wm.className = "bw-wm"; wm.textContent = "Blockwall"; d.appendChild(wm);
        fetch("assets/img/bw-wordmark.svg").then(function (r) { return r.ok ? r.text() : ""; }).then(function (s) { if (s && s.indexOf("<svg") >= 0) wm.innerHTML = s; }).catch(function () {});
      } else { d.textContent = f.t; }
      cube.appendChild(d);
    });
    scene.appendChild(cube); stage.appendChild(scene);
    var ry = 24, tx = 0, ty = 0, cx = 0, cy = 0, raf = null, visible = true;
    function apply() { cube.style.transform = "rotateX(" + (-15 + cx) + "deg) rotateY(" + (ry + cy) + "deg)"; }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { apply(); return; }
    if (matchMedia("(hover:hover)").matches) window.addEventListener("pointermove", function (e) { tx = (e.clientY / innerHeight - 0.5) * -24; ty = (e.clientX / innerWidth - 0.5) * 30; }, { passive: true });
    function frame() { ry += 0.22; cx += (tx - cx) * 0.06; cy += (ty - cy) * 0.06; apply(); raf = requestAnimationFrame(frame); }
    function start() { if (raf == null && visible) frame(); }
    function stop() { if (raf != null) { cancelAnimationFrame(raf); raf = null; } }
    start();
    try { new IntersectionObserver(function (es) { es.forEach(function (en) { visible = en.isIntersecting; if (visible) start(); else stop(); }); }).observe(stage); } catch (e) {}
    document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else start(); });
  }
  window.HeroCube = { mount: function (sel) { var s = document.querySelector(sel); if (!s || s.__cube) return; s.__cube = 1; try { build(s); } catch (e) {} } };
})();
