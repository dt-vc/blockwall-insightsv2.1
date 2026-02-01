# Blockwall Insights v2.1

Premium newsletter archive and content hub for Blockwall Capital.

## 📁 Structure

```
blockwall-insightsv2.1/
├── index.html                 # Homepage with Substack + LinkedIn sections
├── daily/
│   ├── index.html             # Daily archive grid
│   └── blockwall-daily-*.html # Newsletter files
├── weekly/
│   ├── index.html             # Weekly archive grid
│   └── blockwall-weekly-*.html
├── monthly/
│   ├── index.html             # Monthly archive grid
│   └── blockwall-monthly-*.html
├── data/
│   ├── daily.json             # Daily newsletter entries
│   ├── weekly.json            # Weekly digest entries
│   ├── monthly.json           # Monthly report entries
│   ├── substack.json          # Blog articles
│   └── linkedin.json          # LinkedIn posts (manual curation)
├── assets/
│   ├── css/
│   │   ├── main.css           # Main styles
│   │   └── newsletter.css     # Newsletter page styles
│   └── images/
│       └── blockwall-logo.png
├── scripts/
│   └── update_feeds.py        # Update Substack RSS
└── README.md
```

## 🚀 Deployment

1. Upload all files to GitHub repository
2. Go to **Settings** → **Pages**
3. Set Source: **main** branch, **/ (root)** folder
4. Site will be live in 1-2 minutes

## 📝 Content Management

### Daily/Weekly/Monthly Newsletters

Edit the respective JSON file in `data/`:

```json
{
  "date": "2026-02-01",
  "title": "Your Headline Here",
  "filename": "blockwall-daily-2026-02-01.html",
  "sources": 94,
  "bullish": 10,
  "bearish": 54,
  "thumbnail": "https://example.com/image.jpg",
  "snippet": "Brief summary..."
}
```

### Substack Articles

Edit `data/substack.json` or run RSS auto-update:

```bash
pip install feedparser requests
python scripts/update_feeds.py --substack
```

### LinkedIn Posts

LinkedIn requires manual curation. Edit `data/linkedin.json`:

```json
{
  "type": "post",
  "author": "Dominic Briggs",
  "handle": "Co-Founder & Managing Partner at Blockwall",
  "content": "Post text content...",
  "url": "https://www.linkedin.com/feed/update/urn:li:activity:...",
  "date": "2026-01-30"
}
```

**Weekly workflow:**
1. Visit: https://www.linkedin.com/in/dobriggs/recent-activity/all/
2. Copy 2-3 recent posts/reposts
3. Update `data/linkedin.json`
4. Commit and push

## 🎨 Design System

### Theme Toggle
Dark/light mode persists via localStorage (`bw-theme`).

### Colors (CSS variables)
```css
--bw-accent: #8b5cf6;    /* Purple accent */
--bw-green: #22c55e;     /* Bullish */
--bw-red: #ef4444;       /* Bearish */
--bw-blue: #3b82f6;      /* Links */
```

---

**Blockwall Capital** • Frankfurt, Germany
