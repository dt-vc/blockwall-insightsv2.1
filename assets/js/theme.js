/* Blockwall theme toggle — default dark, persisted, wires onto the masthead
   button (which the renderers build async). Pre-paint <head> script sets the
   initial data-theme; this adds the handler + icon + cross-tab sync. */
(function () {
  "use strict";
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';
  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/></svg>';
  function cur() { return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"; }
  function paint(btn) { var t = cur(); btn.innerHTML = t === "light" ? SUN : MOON; btn.setAttribute("aria-pressed", t === "light" ? "true" : "false"); btn.setAttribute("aria-label", t === "light" ? "Switch to dark theme" : "Switch to light theme"); }
  function paintAll() { document.querySelectorAll(".icon-btn[aria-label]").forEach(paint); }
  function set(t) { document.documentElement.setAttribute("data-theme", t); try { localStorage.setItem("bw-theme", t); } catch (e) {} paintAll(); }
  function wire() {
    document.querySelectorAll(".icon-btn[aria-label]").forEach(function (btn) {
      if (btn.__themed) return; btn.__themed = 1; paint(btn);
      btn.addEventListener("click", function () { set(cur() === "light" ? "dark" : "light"); });
    });
  }
  if (document.readyState !== "loading") setTimeout(wire, 0); else document.addEventListener("DOMContentLoaded", wire);
  try { new MutationObserver(wire).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  window.addEventListener("storage", function (e) { if (e.key === "bw-theme" && e.newValue) { document.documentElement.setAttribute("data-theme", e.newValue); paintAll(); } });
})();
