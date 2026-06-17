/* Blockwall smooth scroll — Lenis, reduced-motion guarded. Exposes window.__lenis.
   Preserves auto-scroll decks + sticky elements (runs scroll on main thread). */
(function () {
  "use strict";
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !window.Lenis) return;
  try {
    var lenis = new Lenis({ lerp: 0.1, smoothWheel: true, wheelMultiplier: 1, anchors: true });
    window.__lenis = lenis;
    function raf(t) { lenis.raf(t); requestAnimationFrame(raf); }
    requestAnimationFrame(raf);
  } catch (e) { /* native scroll is the floor */ }
})();
