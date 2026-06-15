/* =============================================
   Blockwall Insights v2 — shared edition renderer
   Renders edition JSON (schema 2) into the page.
   One template per cadence (daily.html / weekly.html / monthly.html)
   calls BWRender.load({ cadence, root }).
   ============================================= */
(function (global) {
  'use strict';

  var SCHEMA_VERSION = 2;

  var SENTIMENT_COLORS = {
    bullish: '#22c55e',
    bearish: '#ef4444',
    neutral: '#94a3b8'
  };

  /* Category icons — same map the existing editions use */
  var CATEGORY_ICONS = {
    Bitcoin: '₿',
    Ethereum: '⟠',
    DeFi: '🔄',
    Stablecoins: '💵',
    Tokenization: '🏛️',
    Payments: '💳',
    Infrastructure: '🔧',
    Layer2: '⚡',
    Regulation: '⚖️',
    Security: '🔒',
    Investment: '📈',
    Enterprise: '🏢',
    NFT_Gaming: '🎮',
    Other: '📰'
  };

  var CADENCE_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ---------- DOM helpers (textContent-based: no HTML injection) ---------- */

  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var key in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
        var val = attrs[key];
        if (val === null || val === undefined || val === false) continue;
        if (key === 'class') node.className = val;
        else if (key === 'style') node.setAttribute('style', val);
        else node.setAttribute(key, val);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      append(node, arguments[i]);
    }
    return node;
  }

  function append(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) {
      for (var i = 0; i < child.length; i++) append(node, child[i]);
    } else if (typeof child === 'string' || typeof child === 'number') {
      node.appendChild(document.createTextNode(String(child)));
    } else {
      node.appendChild(child);
    }
  }

  function safeUrl(url) {
    return (typeof url === 'string' && /^https?:\/\//i.test(url)) ? url : null;
  }

  function extLink(url, className, children) {
    var href = safeUrl(url);
    var node = h(href ? 'a' : 'span', {
      class: className,
      href: href,
      target: href ? '_blank' : null,
      rel: href ? 'noopener' : null
    });
    append(node, children);
    return node;
  }

  function nonEmpty(arr) {
    return Array.isArray(arr) && arr.length > 0;
  }

  function sentimentDot(sentiment, className) {
    var color = SENTIMENT_COLORS[sentiment] || SENTIMENT_COLORS.neutral;
    return h('span', { class: className, style: 'color:' + color }, '●');
  }

  function categoryIcon(category) {
    return CATEGORY_ICONS[category] || CATEGORY_ICONS.Other;
  }

  function sectionTitle(text) {
    return h('h2', { class: 'section-title' }, text);
  }

  function divider() {
    return h('div', { class: 'divider' });
  }

  function fmtShortDate(iso) {
    if (typeof iso !== 'string') return '';
    var m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    return MONTHS_SHORT[parseInt(m[2], 10) - 1] + ' ' + parseInt(m[3], 10);
  }

  function fmtAsOf(iso) {
    if (typeof iso !== 'string') return '';
    var dateOnly = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      return MONTHS_SHORT[parseInt(dateOnly[2], 10) - 1] + ' ' +
        parseInt(dateOnly[3], 10) + ', ' + dateOnly[1];
    }
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var hh = String(d.getUTCHours());
    var mm = String(d.getUTCMinutes());
    if (hh.length < 2) hh = '0' + hh;
    if (mm.length < 2) mm = '0' + mm;
    return MONTHS_SHORT[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + hh + ':' + mm + ' UTC';
  }

  /* ---------- Section builders (each returns a node, or null to skip) ---------- */

  function renderStats(stats) {
    if (!stats) return null;
    var fields = [
      ['sources', 'Sources'],
      ['signals', 'Signals'],
      ['watching', 'Watching'],
      ['bullish', 'Bullish'],
      ['bearish', 'Bearish'],
      ['neutral', 'Neutral']
    ];
    var cells = [];
    for (var i = 0; i < fields.length; i++) {
      var key = fields[i][0];
      if (stats[key] === null || stats[key] === undefined) continue;
      var valueClass = 'newsletter-stat-value' +
        (key === 'bullish' ? ' bullish' : key === 'bearish' ? ' bearish' : '');
      cells.push(h('div', { class: 'newsletter-stat' },
        h('div', { class: valueClass }, stats[key]),
        h('div', { class: 'newsletter-stat-label' }, fields[i][1])
      ));
    }
    if (!cells.length) return null;
    return h('div', { class: 'newsletter-stats stats-' + cells.length }, cells);
  }

  function renderLead(lead) {
    if (!lead || (!lead.headline && !lead.tldr)) return null;
    return h('section', { class: 'lead-block' },
      h('span', { class: 'daily-badge' }, 'The One Thing Today'),
      lead.headline ? h('h2', { class: 'lead-headline' }, lead.headline) : null,
      lead.tldr ? h('div', { class: 'lead-tldr' },
        h('span', { class: 'lead-tldr-label' }, 'TL;DR'),
        h('p', null, lead.tldr)
      ) : null
    );
  }

  function renderIntro(intro) {
    if (!intro) return null;
    return h('div', { class: 'newsletter-intro' }, intro);
  }

  function renderTape(snapshot) {
    if (!snapshot || !nonEmpty(snapshot.items)) return null;
    var items = snapshot.items.map(function (item) {
      var raw = (item.change_24h === null || item.change_24h === undefined) ? '' : String(item.change_24h);
      // Strip a stray leading sentiment bullet the upstream sometimes prepends ("● N/A").
      var changeStr = raw.replace(/^[\s•·●●]+/, '').trim();
      // Only treat it as a real delta (arrow + up/down color) when it STARTS with a
      // number/sign — so placeholders like "N/A" or "N/A (4W: up)" render as neutral
      // text instead of a misleading green up-tick.
      var numeric = /^[+\-−]?[\d.,]/.test(changeStr);
      var direction = (numeric && (item.direction === 'up' || item.direction === 'down'))
        ? item.direction
        : (/^[-−]/.test(changeStr) ? 'down' : 'up');
      var changeClass = numeric ? (direction === 'down' ? 'down' : 'up') : 'flat';
      return h('div', { class: 'tape-item' },
        h('div', { class: 'tape-label' }, item.label),
        h('div', { class: 'tape-value' }, item.value),
        changeStr ? h('div', { class: 'tape-change ' + changeClass },
          (numeric ? (direction === 'down' ? '▾ ' : '▴ ') : '') + changeStr
        ) : null
      );
    });
    var metaParts = [];
    if (snapshot.as_of) metaParts.push('As of ' + fmtAsOf(snapshot.as_of));
    if (snapshot.source) metaParts.push(snapshot.source);
    return h('section', { class: 'tape-section' },
      sectionTitle('📊 The Tape'),
      h('div', { class: 'tape-strip' }, items),
      metaParts.length ? h('div', { class: 'tape-meta' }, metaParts.join(' · ')) : null
    );
  }

  function renderSignal(signal) {
    var meta = [];
    if (signal.source) meta.push(signal.source);
    if (signal.category) meta.push(signal.category);
    if (signal.significance !== null && signal.significance !== undefined) {
      meta.push('Score: ' + signal.significance + '/10');
    }
    var img = null;
    var imgSrc = safeUrl(signal.image_url);
    if (imgSrc) {
      img = h('img', { class: 'story-img', src: imgSrc, alt: signal.title || '' });
      img.addEventListener('error', function () { img.style.display = 'none'; });
    }
    return h('div', { class: 'story', 'data-item-id': signal.id || null },
      h('h2', { class: 'story-title' }, signal.title),
      img,
      meta.length ? h('div', { class: 'story-meta' }, meta.join(' • ')) : null,
      signal.summary ? h('p', { class: 'story-summary' }, signal.summary) : null,
      signal.why_it_matters ? h('div', { class: 'signal-why' },
        h('span', { class: 'signal-why-label' }, 'Why it matters'),
        h('p', null, signal.why_it_matters)
      ) : null,
      nonEmpty(signal.themes) ? h('div', { class: 'signal-themes' },
        signal.themes.map(function (theme) {
          return h('span', { class: 'theme-chip' }, theme);
        })
      ) : null,
      safeUrl(signal.url) ? extLink(signal.url, 'story-link', 'Read full article →') : null
    );
  }

  function renderTopSignals(signals) {
    if (!nonEmpty(signals)) return null;
    var frag = document.createDocumentFragment();
    append(frag, sectionTitle('🔥 Top Signals (' + signals.length + ')'));
    append(frag, signals.map(renderSignal));
    return frag;
  }

  function renderDeals(deals) {
    if (!nonEmpty(deals)) return null;
    var cards = deals.map(function (deal) {
      var metaParts = [];
      if (nonEmpty(deal.investors)) metaParts.push(deal.investors.join(', '));
      if (deal.category) metaParts.push(deal.category);
      var card = extLink(deal.url, 'deal-card', [
        h('div', { class: 'deal-row' },
          h('span', { class: 'deal-company' }, deal.company),
          deal.round ? h('span', { class: 'deal-round' }, deal.round) : null,
          deal.amount ? h('span', { class: 'deal-amount' }, deal.amount) : null
        ),
        metaParts.length ? h('div', { class: 'deal-meta' }, metaParts.join(' · ')) : null,
        deal.summary ? h('div', { class: 'deal-summary' }, deal.summary) : null
      ]);
      if (deal.id) card.setAttribute('data-item-id', deal.id);
      return card;
    });
    return h('section', { class: 'deals-section' },
      sectionTitle('💸 Deals (' + deals.length + ')'),
      h('div', { class: 'deals-list' }, cards)
    );
  }

  function renderRadar(items) {
    if (!nonEmpty(items)) return null;
    var cells = items.map(function (item) {
      var metaParts = [];
      if (item.source) metaParts.push(item.source);
      if (item.category) metaParts.push(item.category);
      return h('div', { class: 'watch-item', 'data-item-id': item.id || null },
        extLink(item.url, null, item.title),
        h('div', { class: 'watch-meta' },
          sentimentDot(item.sentiment, null), ' ',
          metaParts.join(' • ')
        ),
        item.summary ? h('div', { class: 'watch-summary' }, item.summary) : null,
        item.why_it_matters ? h('div', { class: 'signal-why' },
          h('span', { class: 'signal-why-label' }, 'Why it matters'),
          h('p', null, item.why_it_matters)
        ) : null
      );
    });
    var frag = document.createDocumentFragment();
    append(frag, sectionTitle('👀 On the Radar (' + items.length + ')'));
    append(frag, h('div', { class: 'watch-grid' }, cells));
    return frag;
  }

  function renderWorthARead(items) {
    if (!nonEmpty(items)) return null;
    var rows = items.map(function (item) {
      return h('div', { class: 'read-item', 'data-item-id': item.id || null },
        h('div', { class: 'read-head' },
          extLink(item.url, 'read-title', item.title),
          item.source ? h('span', { class: 'read-source' }, item.source) : null
        ),
        item.note ? h('p', { class: 'read-note' }, item.note) : null
      );
    });
    return h('section', { class: 'read-section' },
      sectionTitle('📖 Worth a Read'),
      h('div', { class: 'read-list' }, rows)
    );
  }

  function renderWhatToWatch(items) {
    if (!nonEmpty(items)) return null;
    var rows = items.map(function (item) {
      return h('div', { class: 'wtw-item' },
        item.date ? h('span', { class: 'wtw-date' }, fmtShortDate(item.date)) : null,
        h('div', { class: 'wtw-body' },
          h('span', { class: 'wtw-label' }, item.label),
          item.note ? h('p', { class: 'wtw-note' }, item.note) : null
        )
      );
    });
    return h('section', { class: 'wtw-section' },
      sectionTitle('🗓️ What to Watch'),
      h('div', { class: 'wtw-list' }, rows)
    );
  }

  function renderAllResources(groups) {
    if (!nonEmpty(groups)) return null;
    var total = 0;
    groups.forEach(function (group) {
      total += nonEmpty(group.items) ? group.items.length : 0;
    });
    if (!total) return null;
    var renderedIdx = 0;
    var categories = groups.map(function (group) {
      if (!nonEmpty(group.items)) return null;
      var open = renderedIdx < 2; /* first two rendered categories expanded, like live editions */
      renderedIdx++;
      var cards = group.items.map(function (item) {
        var card = extLink(item.url, 'res-card', [
          sentimentDot(item.sentiment, 'res-dot'),
          h('span', { class: 'res-card-text' },
            h('span', { class: 'res-card-title' }, item.title),
            item.source ? h('span', { class: 'res-card-source' }, item.source) : null
          )
        ]);
        if (item.id) card.setAttribute('data-item-id', item.id);
        return card;
      });
      return h('div', { class: 'res-category' },
        h('button', { class: 'res-cat-header', type: 'button', 'aria-expanded': open ? 'true' : 'false' },
          h('span', { class: 'res-cat-title' },
            categoryIcon(group.category) + ' ' + group.category + ' ',
            h('span', { class: 'res-cat-count' }, group.items.length)
          ),
          h('span', { class: 'res-cat-chevron' }, open ? '▾' : '▸')
        ),
        h('div', { class: 'res-cat-body', style: 'display:' + (open ? 'block' : 'none') }, cards)
      );
    });
    return h('div', { class: 'resources-section' },
      sectionTitle('📚 All Resources (' + total + ')'),
      h('div', { class: 'resources-accordion' }, categories)
    );
  }

  function renderLinkedIn(post) {
    if (!post) return null;
    return h('div', { class: 'linkedin-box' },
      h('h3', null, '💼 LinkedIn Ready'),
      h('p', { class: 'linkedin-label' }, 'Copy and paste:'),
      h('div', { class: 'linkedin-content' }, post)
    );
  }

  function renderSources(signals) {
    if (!nonEmpty(signals)) return null;
    var rows = signals.map(function (signal, index) {
      return h('li', null,
        h('span', { class: 'source-num' }, '[' + (index + 1) + ']'), ' ',
        extLink(signal.url, null, signal.title), ' ',
        signal.source ? h('span', { class: 'other-source' }, '(' + signal.source + ')') : null
      );
    });
    return h('div', null,
      h('h3', { class: 'section-title' }, '📚 Highlight Sources'),
      h('ul', { class: 'sources-list' }, rows)
    );
  }

  /* ---------- Edition assembly ---------- */

  function renderEdition(edition, root) {
    root.innerHTML = '';

    var sections = [
      renderStats(edition.stats),
      renderLead(edition.lead),
      renderIntro(edition.intro),
      renderTape(edition.market_snapshot),
      renderTopSignals(edition.top_signals),
      renderDeals(edition.deals),
      renderRadar(edition.on_the_radar),
      renderWorthARead(edition.worth_a_read),
      renderWhatToWatch(edition.what_to_watch),
      renderAllResources(edition.all_resources),
      renderLinkedIn(edition.linkedin_post),
      renderSources(edition.top_signals)
    ];

    var rendered = 0;
    sections.forEach(function (section) {
      if (!section) return;
      if (rendered > 0) append(root, divider());
      append(root, section);
      rendered++;
    });

    /* Accordion toggling (delegated, replaces per-page toggleCategory).
       Bound once per root so repeated renderEdition calls don't stack listeners. */
    if (!root._bwAccordionBound) {
      root._bwAccordionBound = true;
      root.addEventListener('click', function (event) {
        var btn = event.target.closest ? event.target.closest('.res-cat-header') : null;
        if (!btn || !root.contains(btn)) return;
        var body = btn.nextElementSibling;
        var chevron = btn.querySelector('.res-cat-chevron');
        var isOpen = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!isOpen));
        if (body) body.style.display = isOpen ? 'none' : 'block';
        if (chevron) chevron.textContent = isOpen ? '▸' : '▾';
      });
    }
  }

  function renderError(root, message, archiveHref) {
    root.innerHTML = '';
    append(root, h('div', { class: 'nl-error' },
      h('h3', null, 'Edition not available'),
      h('p', null, message),
      h('a', { href: archiveHref, class: 'story-link' }, 'Browse the archive →')
    ));
  }

  /* ---------- Entry point ---------- */

  function load(options) {
    var cadence = options.cadence;
    var root = typeof options.root === 'string' ? document.querySelector(options.root) : options.root;
    var archiveHref = options.archiveHref || (cadence + '/index.html');
    var dateEl = options.dateEl ? document.querySelector(options.dateEl) : null;

    var params = new URLSearchParams(global.location.search);
    var id = params.get('id') || '';

    if (!/^[\w][\w.-]*$/.test(id)) {
      renderError(root, 'No edition specified. Pick one from the ' + cadence + ' archive.', archiveHref);
      return;
    }

    fetch('data/' + cadence + '/' + id + '.json')
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (edition) {
        if (edition.schema !== SCHEMA_VERSION) {
          throw new Error('Unsupported schema version: ' + edition.schema);
        }
        if (edition.date_display) {
          if (dateEl) dateEl.textContent = edition.date_display;
          document.title = 'Blockwall ' + (CADENCE_LABELS[cadence] || cadence) +
            ' Insights - ' + edition.date_display;
        }
        renderEdition(edition, root);
        /* announce for optional layers (e.g. the curation/save UI) */
        document.dispatchEvent(new CustomEvent('bw:rendered', {
          detail: { edition: edition, cadence: cadence }
        }));
      })
      .catch(function (error) {
        renderError(root,
          'Could not load the ' + cadence + ' edition "' + id + '" (' + error.message + ').',
          archiveHref);
      });
  }

  global.BWRender = {
    load: load,
    renderEdition: renderEdition
  };

})(window);
