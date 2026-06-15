<p align="center">
  <img src="https://dt-vc.github.io/blockwall-insightsv2.1/assets/images/blockwall-cover.svg" alt="Blockwall Insights v2.1" width="100%"/>
</p>

<p align="center">
  <a href="https://dt-vc.github.io/blockwall-insightsv2.1/"><img src="https://img.shields.io/badge/Live-Platform-00d4ff?style=for-the-badge&logo=github&logoColor=white" alt="Live Platform"/></a>
  <a href="https://insights.blockwall.vc"><img src="https://img.shields.io/badge/Substack-Blog-7b61ff?style=for-the-badge&logo=substack&logoColor=white" alt="Substack"/></a>
  <a href="https://blockwall.vc"><img src="https://img.shields.io/badge/Blockwall-VC-00ffa3?style=for-the-badge&logoColor=white" alt="Blockwall VC"/></a>
</p>

---

## About

**Blockwall Insights v2.1** is an AI-curated crypto intelligence platform for founders, investors, and Web3 professionals. It aggregates 100+ sources and distills them into scannable VC briefings across three cadences.

### Newsletter Formats

| Format | Sources | Read Time | Cadence |
|--------|---------|-----------|---------|
| **Daily** | ~100 | 2 min | Daily |
| **Weekly** | ~500 | 8 min | Weekly (ISO week) |
| **Monthly** | ~800 | 15 min | Monthly |
| **Portfolio** | 24 companies | 5 min | Weekly refresh |

---

## How it works (v2)

v2 is **JSON-driven**: content and design are fully separated. The upstream **n8n pipeline is the sole writer of `data/`** — it assembles each edition as structured JSON and commits it (plus a manifest entry) straight to `main`; GitHub Pages then auto-deploys. The site owns 100% of rendering through **one template per cadence**, so there is no per-edition HTML and no manual publish step.

```
n8n pipeline ──commits──▶  data/<cadence>/<id>.json   (full edition)
                           data/<cadence>.json        (newest-first manifest)
                                     │
                GitHub Pages deploy  ▼
   <cadence>.html?id=<id>  ──render.js──▶  rendered edition
   <cadence>/index.html    ──reads manifest──▶  archive cards
```

- **`assets/js/render.js`** — shared renderer; fetches an edition JSON (id from the `?id=` query) and builds the DOM for every section (lead, The Tape, top signals, deals, on the radar, worth a read, what to watch, all resources, LinkedIn-ready).
- **`daily.html` / `weekly.html` / `monthly.html`** — thin per-cadence templates that call `render.js`.
- **`daily/` `weekly/` `monthly/` `index.html`** — archive pages that render the manifest as cards linking to `<cadence>.html?id=<id>`.
- **Curation / shortlist** — `assets/js/curate.js` + `saved.html`: analysts star items (with a note + theme tag) on any edition; saves persist to a NeonDB `bw_curated` table via an n8n webhook and surface, grouped by theme, in the Saved view. This is the raw material for the month-end Substack monthly.
- **Schema-validation CI** — `scripts/validate_editions.py` + `.github/workflows/validate-editions.yml` validate every edition JSON and manifest on each push to `data/**` (bad JSON, off-schema editions, or a manifest entry with no edition file fail the build).

### Repository layout

```
blockwall-insightsv2.1/
├── index.html                     # Homepage
├── daily.html / weekly.html / monthly.html   # Per-cadence edition templates
├── saved.html                     # Curation shortlist view
├── assets/
│   ├── css/                       # main.css + newsletter.css (the design system)
│   ├── js/                        # render.js (renderer) + curate.js (save layer)
│   └── images/ companies/
├── daily/ weekly/ monthly/        # Archive index pages (index.html each)
├── data/
│   ├── daily/ weekly/ monthly/    # Per-edition JSON (pipeline-written)
│   ├── daily.json weekly.json monthly.json   # Manifests (pipeline-written)
│   └── portfolio/ dealflow/       # Portfolio + dealflow data (frozen)
├── portfolio/                     # Portfolio company pages (frozen)
├── scripts/                       # validate_editions.py (+ one-off migration)
└── .github/workflows/             # validate-editions.yml (schema CI)
```

### Tech Stack

- **Hosting**: GitHub Pages (static; deploys on push to `main`)
- **Rendering**: client-side, one shared renderer per cadence (schema 2 JSON contract)
- **Content pipeline**: n8n workflows + NeonDB PostgreSQL + AI enrichment (upstream; commits edition JSON to this repo)
- **Curation store**: NeonDB `bw_curated`, written via an n8n webhook
- **Quality gate**: stdlib Python schema validator in GitHub Actions

> The per-edition HTML archive and the manual publish loop from v1 have been retired — design now lives only in the templates and CSS.

---

<p align="center">
  <sub>Built by <a href="https://blockwall.vc">Blockwall Management GmbH</a> · Frankfurt, Germany · European Crypto Venture Capital</sub>
</p>
