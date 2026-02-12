<p align="center">
  <img src="assets/images/blockwall-cover.svg" alt="Blockwall Insights v2.1" width="100%"/>
</p>

<p align="center">
  <a href="https://dt-vc.github.io/blockwall-insightsv2.1/"><img src="https://img.shields.io/badge/Live-Platform-00d4ff?style=for-the-badge&logo=github&logoColor=white" alt="Live Platform"/></a>
  <a href="https://insights.blockwall.vc"><img src="https://img.shields.io/badge/Substack-Blog-7b61ff?style=for-the-badge&logo=substack&logoColor=white" alt="Substack"/></a>
  <a href="https://blockwall.vc"><img src="https://img.shields.io/badge/Blockwall-VC-00ffa3?style=for-the-badge&logoColor=white" alt="Blockwall VC"/></a>
</p>

---

## About

**Blockwall Insights v2.1** is an AI-curated crypto intelligence platform built for founders, investors, and Web3 professionals. It aggregates 100+ sources daily and distills them into actionable briefings across multiple formats.

### Newsletter Formats

| Format | Sources | Stories | Read Time |
|--------|---------|---------|-----------|
| **Daily** | ~100 | 6 | 2 min |
| **Weekly** | ~500 | 15 | 8 min |
| **Monthly** | ~800 | 20 | 15 min |
| **Portfolio** | 24 companies | Sector-specific | 5 min |

### Architecture

```
blockwall-insightsv2.1/
├── assets/          # Styles, images, scripts
├── daily/           # Daily newsletter archive
├── weekly/          # Weekly digest archive
├── monthly/         # Monthly reports archive
├── portfolio/       # Portfolio company intelligence
├── data/            # Data feeds & configs
├── scripts/         # Automation scripts
└── index.html       # Main landing page
```

### Tech Stack

- **Hosting**: GitHub Pages (static site)
- **Automation**: n8n workflows + NeonDB PostgreSQL
- **AI Processing**: Gemini 1.5 Flash for content enrichment
- **Data**: 100+ RSS feeds, aggregated & deduplicated daily
- **Updates**: Automated daily at 9:00 CET

---

<p align="center">
  <sub>Built by <a href="https://blockwall.vc">Blockwall Management GmbH</a> · Frankfurt, Germany · European Crypto Venture Capital</sub>
</p>
