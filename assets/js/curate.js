/* =============================================
   Blockwall Insights v2 — curation / save layer (§6)
   Decorates rendered edition items with a save/star control
   (+ one-line note + theme tag) and renders the Saved view.
   Persistence is the n8n webhook -> bw_curated in NeonDB;
   localStorage only remembers the analyst's NAME.
   ============================================= */
(function (global) {
  'use strict';

  var WEBHOOK_BASE = 'https://blockwall.app.n8n.cloud';
  var CURATE_URL = WEBHOOK_BASE + '/webhook/bw-curate';
  var CURATED_URL = WEBHOOK_BASE + '/webhook/bw-curated';
  var ANALYST_KEY = 'bw-analyst';

  /* ---------- DOM helpers (textContent-based: no HTML injection) ---------- */

  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var key in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
        var val = attrs[key];
        if (val === null || val === undefined || val === false) continue;
        if (key === 'class') node.className = val;
        else node.setAttribute(key, val);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) {
        for (var j = 0; j < child.length; j++) {
          if (child[j] !== null && child[j] !== undefined) node.appendChild(child[j]);
        }
      } else if (typeof child === 'string' || typeof child === 'number') {
        node.appendChild(document.createTextNode(String(child)));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  function safeUrl(url) {
    return (typeof url === 'string' && /^https?:\/\//i.test(url)) ? url : null;
  }

  function getAnalyst() {
    try { return (localStorage.getItem(ANALYST_KEY) || '').trim(); } catch (e) { return ''; }
  }

  function setAnalyst(name) {
    try { localStorage.setItem(ANALYST_KEY, name.trim()); } catch (e) { /* private mode */ }
  }

  /* The webhook returns an EMPTY body (not []) when the table is empty. */
  function fetchRows() {
    return fetch(CURATED_URL).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (body) {
      if (!body) return [];
      var rows = JSON.parse(body);
      return Array.isArray(rows) ? rows : [];
    });
  }

  function saveRow(row) {
    return fetch(CURATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
    });
  }

  function deleteRow(editionId, itemId, analyst) {
    var qs = '?edition_id=' + encodeURIComponent(editionId) +
      '&item_id=' + encodeURIComponent(itemId) +
      '&analyst=' + encodeURIComponent(analyst);
    return fetch(CURATE_URL + qs, { method: 'DELETE' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
    });
  }

  /* ---------- analyst bar (shared by edition pages and the Saved view) ---------- */

  function buildBar(opts) {
    var input = h('input', {
      class: 'curate-analyst', type: 'text', maxlength: '40',
      placeholder: 'Your name', value: getAnalyst() || null,
      'aria-label': 'Analyst name'
    });
    input.addEventListener('change', function () {
      setAnalyst(input.value);
      if (opts.onAnalystChange) opts.onAnalystChange(getAnalyst());
    });
    return h('div', { class: 'curate-bar' },
      h('span', { class: 'curate-bar-label' }, '★ Shortlist'),
      h('span', { class: 'curate-bar-hint' }, 'Analyst'),
      input,
      h('span', { class: 'curate-status', role: 'status', 'aria-live': 'polite' }),
      opts.showSavedLink ? h('a', { class: 'curate-saved-link', href: 'saved.html' }, 'View Saved →') : null
    );
  }

  /* Non-blocking status in the bar. message=null clears it. */
  function setStatus(bar, message, onRetry) {
    var el = bar.querySelector('.curate-status');
    if (!el) return;
    el.textContent = '';
    if (!message) return;
    el.appendChild(document.createTextNode('⚠ ' + message + ' '));
    if (onRetry) {
      var btn = h('button', { type: 'button' }, 'Retry');
      btn.addEventListener('click', onRetry);
      el.appendChild(btn);
    }
  }

  function requireAnalyst(bar) {
    var name = getAnalyst();
    if (name) return name;
    var input = bar.querySelector('.curate-analyst');
    input.focus();
    bar.classList.add('curate-bar-attention');
    setTimeout(function () { bar.classList.remove('curate-bar-attention'); }, 1500);
    return null;
  }

  /* ---------- edition page: item index + decoration ---------- */

  function indexEdition(edition) {
    var map = {};
    function add(item, extra) {
      if (!item || !item.id) return;
      var theme = (item.themes && item.themes[0]) ||
        ((extra.category || item.category || '')).toLowerCase();
      var incoming = {
        title: extra.title || item.title || '',
        url: item.url || null,
        // primary_source = the clean publication name (e.g. "The Block").
        // It lives in the item's `source` field; the item's own `primary_source`
        // field is an origin URL (top_signals only) and is intentionally not used here.
        primary_source: item.source || null,
        category: item.category || extra.category || null,
        theme: theme
      };
      var existing = map[item.id];
      if (!existing) { map[item.id] = incoming; return; }
      // Same id appears in more than one section (real production editions reuse
      // an article id across top_signals/deals/all_resources). Sections are added
      // richest-first, so MERGE keeping each existing non-empty field rather than
      // letting a later, sparser section (e.g. all_resources) blank out a
      // descriptive title/category captured earlier. One logical save per id.
      existing.title = existing.title || incoming.title;
      existing.url = existing.url || incoming.url;
      existing.primary_source = existing.primary_source || incoming.primary_source;
      existing.category = existing.category || incoming.category;
      existing.theme = existing.theme || incoming.theme;
    }
    (edition.top_signals || []).forEach(function (s) { add(s, {}); });
    (edition.deals || []).forEach(function (d) {
      add(d, { title: [d.company, d.amount, d.round].filter(Boolean).join(' · ') });
    });
    (edition.on_the_radar || []).forEach(function (r) { add(r, {}); });
    (edition.worth_a_read || []).forEach(function (w) { add(w, {}); });
    (edition.all_resources || []).forEach(function (group) {
      (group.items || []).forEach(function (i) { add(i, { category: group.category }); });
    });
    return map;
  }

  function markSaved(itemId, saved) {
    var hosts = document.querySelectorAll('[data-item-id="' + itemId + '"]');
    for (var i = 0; i < hosts.length; i++) {
      var star = hosts[i].querySelector('.curate-star');
      if (!star) continue;
      star.textContent = saved ? '★' : '☆';
      star.classList.toggle('saved', saved);
      star.setAttribute('aria-pressed', String(saved));
      star.title = saved ? 'Remove from shortlist' : 'Save to shortlist';
    }
  }

  function initEditionPage(edition, cadence, bar) {
    var items = indexEdition(edition);
    var savedSet = {};

    function refreshSavedState() {
      var analyst = getAnalyst();
      savedSet = {};
      if (!analyst) {
        Object.keys(items).forEach(function (id) { markSaved(id, false); });
        return;
      }
      fetchRows().then(function (rows) {
        rows.forEach(function (row) {
          if (row.edition_id === edition.id && row.analyst === analyst) {
            savedSet[row.item_id] = true;
          }
        });
        Object.keys(items).forEach(function (id) { markSaved(id, !!savedSet[id]); });
        setStatus(bar, null);
      }).catch(function (err) {
        if (global.console) console.error('bw-curate: could not load saved state', err);
        // Surface it: a failed hydrate must NOT silently look like "nothing saved".
        setStatus(bar, "Couldn't sync your shortlist — stars may be out of date.", refreshSavedState);
      });
    }

    function closePanels() {
      var open = document.querySelectorAll('.curate-panel');
      for (var i = 0; i < open.length; i++) open[i].parentNode.removeChild(open[i]);
    }

    function openPanel(host, itemId) {
      closePanels();
      var meta = items[itemId];
      var note = h('input', {
        class: 'curate-note', type: 'text', maxlength: '200',
        placeholder: 'One-line note (optional)', 'aria-label': 'Note'
      });
      var theme = h('input', {
        class: 'curate-theme', type: 'text', maxlength: '40',
        placeholder: 'theme', value: meta.theme || null, 'aria-label': 'Theme tag'
      });
      var saveBtn = h('button', { class: 'curate-save', type: 'button' }, 'Save');
      var cancelBtn = h('button', { class: 'curate-cancel', type: 'button' }, 'Cancel');
      var panel = h('div', { class: 'curate-panel' }, note, theme, saveBtn, cancelBtn);

      function doSave() {
        var analyst = requireAnalyst(bar);
        if (!analyst) return;
        saveBtn.disabled = true;
        saveBtn.textContent = '…';
        saveRow({
          edition_id: edition.id,
          item_id: itemId,
          cadence: cadence,
          title: meta.title,
          url: meta.url,
          primary_source: meta.primary_source,
          category: meta.category,
          theme: theme.value.trim(),
          note: note.value.trim(),
          analyst: analyst,
          saved_at: new Date().toISOString()
        }).then(function () {
          savedSet[itemId] = true;
          markSaved(itemId, true);
          setStatus(bar, null);
          closePanels();
        }).catch(function (err) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Retry';
          if (global.console) console.error('bw-curate: save failed', err);
          setStatus(bar, "Save didn't reach the server — not saved. Try again.");
        });
      }

      saveBtn.addEventListener('click', doSave);
      cancelBtn.addEventListener('click', closePanels);
      [note, theme].forEach(function (input) {
        input.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); doSave(); }
          if (ev.key === 'Escape') closePanels();
        });
      });

      host.insertAdjacentElement('afterend', panel);
      note.focus();
    }

    function onStarClick(ev, host, star, itemId) {
      ev.preventDefault();
      ev.stopPropagation();
      if (star.disabled) return;
      if (savedSet[itemId]) {
        var analyst = requireAnalyst(bar);
        if (!analyst) return;
        star.disabled = true;
        deleteRow(edition.id, itemId, analyst).then(function () {
          star.disabled = false;
          delete savedSet[itemId];
          markSaved(itemId, false);
          setStatus(bar, null);
        }).catch(function (err) {
          star.disabled = false;
          if (global.console) console.error('bw-curate: unsave failed', err);
          setStatus(bar, "Couldn't remove that item — still saved. Try again.");
        });
      } else {
        openPanel(host, itemId);
      }
    }

    var hosts = document.querySelectorAll('[data-item-id]');
    for (var i = 0; i < hosts.length; i++) {
      (function (host) {
        var itemId = host.getAttribute('data-item-id');
        if (!items[itemId]) return;
        host.classList.add('curate-host');
        var star = h('button', {
          class: 'curate-star', type: 'button',
          title: 'Save to shortlist', 'aria-pressed': 'false'
        }, '☆');
        star.addEventListener('click', function (ev) { onStarClick(ev, host, star, itemId); });
        host.appendChild(star);
      })(hosts[i]);
    }

    refreshSavedState();
    return refreshSavedState;
  }

  /* ---------- Saved / Shortlist view ---------- */

  function savedItemNode(row, analyst, onRemoved) {
    var meta = [];
    if (row.analyst) meta.push(row.analyst);
    if (row.cadence && row.edition_id) meta.push(row.cadence + ' ' + row.edition_id);
    if (row.category) meta.push(row.category);
    if (row.primary_source) meta.push(row.primary_source);  // publication name
    if (row.saved_at) meta.push(String(row.saved_at).slice(0, 10));

    var links = [];
    if (row.cadence && row.edition_id) {
      links.push(h('a', {
        class: 'saved-item-link',
        href: row.cadence + '.html?id=' + encodeURIComponent(row.edition_id)
      }, 'Open edition →'));
    }

    var removeBtn = null;
    if (analyst && row.analyst === analyst) {
      removeBtn = h('button', { class: 'saved-item-remove', type: 'button', title: 'Remove from shortlist' }, '✕');
    }

    var node = h('div', { class: 'saved-item' },
      h('div', { class: 'saved-item-head' },
        safeUrl(row.url)
          ? h('a', { class: 'saved-item-title', href: row.url, target: '_blank', rel: 'noopener' }, row.title || row.item_id)
          : h('span', { class: 'saved-item-title' }, row.title || row.item_id),
        removeBtn
      ),
      h('div', { class: 'saved-item-meta' }, meta.join(' · ')),
      row.note ? h('p', { class: 'saved-item-note' }, row.note) : null,
      links.length ? h('div', { class: 'saved-item-links' }, links) : null
    );

    if (removeBtn) {
      removeBtn.addEventListener('click', function () {
        removeBtn.disabled = true;
        deleteRow(row.edition_id, row.item_id, analyst).then(function () {
          onRemoved(node);
        }).catch(function (err) {
          removeBtn.disabled = false;
          if (global.console) console.error('bw-curate: remove failed', err);
        });
      });
    }
    return node;
  }

  function renderSavedView(root) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'loading-text' }, 'Loading shortlist…'));
    var analyst = getAnalyst();

    fetchRows().then(function (rows) {
      root.innerHTML = '';
      if (!rows.length) {
        root.appendChild(h('div', { class: 'empty-state' },
          'Nothing saved yet. Star items in any edition to build the month-end shortlist.'));
        return;
      }
      rows.sort(function (a, b) {
        return String(b.saved_at || '').localeCompare(String(a.saved_at || ''));
      });

      var groups = {};
      var order = [];
      rows.forEach(function (row) {
        var key = (row.theme || '').trim() || 'untagged';
        if (!groups[key]) { groups[key] = []; order.push(key); }
        groups[key].push(row);
      });

      function onRemoved(node) {
        var group = node.parentNode;
        node.parentNode.removeChild(node);
        if (group && !group.querySelector('.saved-item')) {
          var section = group.parentNode;
          section.parentNode.removeChild(section);
        }
      }

      order.forEach(function (key) {
        var body = h('div', { class: 'saved-group-body' },
          groups[key].map(function (row) { return savedItemNode(row, analyst, onRemoved); }));
        root.appendChild(h('section', { class: 'saved-group' },
          h('h2', { class: 'saved-group-title' },
            h('span', { class: 'theme-chip' }, key), ' ',
            h('span', { class: 'saved-group-count' }, groups[key].length + (groups[key].length === 1 ? ' item' : ' items'))),
          body));
      });
    }).catch(function (err) {
      root.innerHTML = '';
      root.appendChild(h('div', { class: 'empty-state' },
        'Could not load the shortlist (' + err.message + '). Refresh to retry.'));
    });
  }

  /* ---------- wiring ---------- */

  /* Edition pages: render.js announces the rendered edition. */
  document.addEventListener('bw:rendered', function (ev) {
    var edition = ev.detail.edition;
    var cadence = ev.detail.cadence;
    var root = document.getElementById('edition-root');
    if (!root) return;
    var refresh;
    var bar = buildBar({
      showSavedLink: true,
      onAnalystChange: function () { if (refresh) refresh(); }
    });
    root.insertAdjacentElement('beforebegin', bar);
    refresh = initEditionPage(edition, cadence, bar);
  });

  /* Saved view page. */
  document.addEventListener('DOMContentLoaded', function () {
    var savedRoot = document.getElementById('saved-root');
    if (!savedRoot) return;
    var bar = buildBar({
      showSavedLink: false,
      onAnalystChange: function () { renderSavedView(savedRoot); }
    });
    savedRoot.insertAdjacentElement('beforebegin', bar);
    renderSavedView(savedRoot);
  });

  global.BWCurate = { renderSavedView: renderSavedView };

})(window);
