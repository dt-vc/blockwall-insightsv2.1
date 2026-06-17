/* AutoScroll — smooth transform-based auto-scroll with hover/focus pause +
   wheel/drag MANUAL scroll on hover, resume on out. GPU transform (sub-pixel
   smooth); reduced-motion = plain native scroll. API: AutoScroll.init(sectionEl, opts). */
(function (global) {
  "use strict";
  var reduceMQ = matchMedia("(prefers-reduced-motion: reduce)");

  function init(section, opts) {
    opts = opts || {};
    var vertical = (opts.axis || "y") !== "x", speed = opts.speed || 22;
    var view = section.querySelector(".ascroll__view");
    var track = section.querySelector(".ascroll__track");
    var toggle = section.querySelector(".ascroll__toggle");
    if (!view || !track) return null;
    /* touch / coarse-pointer devices: plain native-scroll list — no auto-scroll,
       no drag (which would trap page scroll), no pause toggle. */
    if (matchMedia("(hover:none),(pointer:coarse)").matches) {
      view.style.overflowY = vertical ? "auto" : "hidden"; view.style.overflowX = vertical ? "hidden" : "auto";
      view.style.webkitMaskImage = "none"; view.style.maskImage = "none";
      if (toggle) toggle.style.display = "none"; section.classList.add("ascroll--static"); return null;
    }

    var originals = Array.prototype.slice.call(track.children);
    var cloned = false, pos = 0, H = 0, raf = null, last = 0;
    var pauses = new Set();

    function sizeOf(el) { return vertical ? el.scrollHeight : el.scrollWidth; }
    function viewSize() { return vertical ? view.clientHeight : view.clientWidth; }
    function overflowing() { return sizeOf(track) > viewSize() + 8; }
    function clone() {
      if (cloned) return;
      originals.forEach(function (li) { var c = li.cloneNode(true); c.setAttribute("aria-hidden", "true"); c.classList.add("is-clone");
        c.querySelectorAll("a,button,input,[tabindex]").forEach(function (e) { e.setAttribute("tabindex", "-1"); });
        c.querySelectorAll(".star").forEach(function (b) { b.disabled = true; });
        c.querySelectorAll("[data-item-id]").forEach(function (n) { n.removeAttribute("data-item-id"); });
        track.appendChild(c); });
      cloned = true;
    }
    function unclone() { Array.prototype.slice.call(track.querySelectorAll(".is-clone")).forEach(function (c) { c.remove(); }); cloned = false; }
    function measure() { var fc = track.children[originals.length]; H = fc ? (vertical ? fc.offsetTop : fc.offsetLeft) : sizeOf(track); }
    function wrap() { if (H > 0) pos = ((pos % H) + H) % H; }
    function apply() { track.style.transform = vertical ? ("translate3d(0," + (-pos) + "px,0)") : ("translate3d(" + (-pos) + "px,0,0)"); }
    function engaged(on) { view.classList.toggle("is-engaged", on); }
    function frame(ts) { if (!last) last = ts; var dt = ts - last; last = ts; if (pauses.size === 0 && H > 0) { pos += speed * dt / 1000; wrap(); apply(); } raf = requestAnimationFrame(frame); }
    function start() { if (raf || reduceMQ.matches || !overflowing()) return; clone(); measure(); last = 0; raf = requestAnimationFrame(frame); }
    function stop() { if (raf) { cancelAnimationFrame(raf); raf = null; } }
    function pause(r) { pauses.add(r); engaged(true); }
    function resume(r) { pauses.delete(r); if (pauses.size === 0) engaged(false); }

    view.addEventListener("pointerenter", function () { pause("hover"); });
    view.addEventListener("pointerleave", function () { resume("hover"); });
    view.addEventListener("focusin", function () { pause("focus"); });
    view.addEventListener("focusout", function () { resume("focus"); });
    document.addEventListener("visibilitychange", function () { if (document.hidden) pause("hidden"); else resume("hidden"); });

    /* manual WHEEL while hovered/paused → scroll the list (trap page scroll) */
    view.addEventListener("wheel", function (e) {
      if (reduceMQ.matches || pauses.size === 0) return;
      var d = vertical ? e.deltaY : (e.deltaX || e.deltaY); if (!d) return;
      pos += d; wrap(); apply(); e.preventDefault();
    }, { passive: false });

    /* drag — only ENGAGES (captures the pointer) after the press moves past a
       threshold, so plain clicks on links/star buttons inside the list still fire. */
    var pressing = false, dragging = false, startC = 0, startPos = 0, moved = 0, suppress = false, pid = null;
    view.addEventListener("pointerdown", function (e) { pressing = true; dragging = false; moved = 0; startC = vertical ? e.clientY : e.clientX; startPos = pos; pid = e.pointerId; });
    view.addEventListener("pointermove", function (e) {
      if (!pressing) return; var c = vertical ? e.clientY : e.clientX; var d = c - startC; moved = Math.max(moved, Math.abs(d));
      if (!dragging && moved > 5) { dragging = true; try { view.setPointerCapture(pid); } catch (_) {} pause("drag"); view.classList.add("is-dragging"); }
      if (dragging) { pos = startPos - d; wrap(); apply(); }
    });
    function endPress() { if (!pressing) return; pressing = false; if (dragging) { dragging = false; try { view.releasePointerCapture(pid); } catch (_) {} view.classList.remove("is-dragging"); resume("drag"); suppress = true; setTimeout(function () { suppress = false; }, 50); } }
    view.addEventListener("pointerup", endPress);
    view.addEventListener("pointercancel", endPress);
    view.addEventListener("click", function (e) { if (suppress) { e.preventDefault(); e.stopPropagation(); } }, true);

    if (toggle) toggle.addEventListener("click", function () {
      var on = toggle.getAttribute("aria-pressed") === "true";
      if (on) { resume("user"); toggle.setAttribute("aria-pressed", "false"); toggle.setAttribute("aria-label", "Pause auto-scroll"); toggle.textContent = "⏸"; }
      else { pause("user"); toggle.setAttribute("aria-pressed", "true"); toggle.setAttribute("aria-label", "Resume auto-scroll"); toggle.textContent = "▶"; }
    });

    function applyRM() {
      if (reduceMQ.matches) { stop(); unclone(); track.style.transform = ""; view.style.overflowY = vertical ? "auto" : "hidden"; view.style.overflowX = vertical ? "hidden" : "auto"; if (toggle) { toggle.disabled = true; toggle.textContent = "▶"; } }
      else { if (toggle) toggle.disabled = false; view.style.overflow = "hidden"; start(); }
    }
    if (reduceMQ.addEventListener) reduceMQ.addEventListener("change", applyRM);

    var imgs = track.querySelectorAll("img");
    Promise.allSettled(Array.prototype.map.call(imgs, function (i) { return (i.decode ? i.decode() : Promise.resolve()).catch(function () {}); }))
      .then(function () { if (cloned) measure(); else applyRM(); });
    if (global.ResizeObserver) { new ResizeObserver(function () { if (cloned) measure(); }).observe(view); }
    applyRM();
    return { start: start, stop: stop, pause: pause, resume: resume };
  }

  global.AutoScroll = { init: init };
})(window);
