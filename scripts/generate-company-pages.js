#!/usr/bin/env node
/**
 * Generate Portfolio Company Pages
 *
 * Generates static HTML pages for all 24 portfolio companies
 * using the main.css design system.
 *
 * Usage: node generate-company-pages.js
 */

const fs = require('fs');
const path = require('path');

const companies = [
  { slug: 'bloxmove', name: 'BloXmove', sector: 'Mobility', location: 'Berlin, Germany', description: 'Blockchain-based mobility ecosystem enabling seamless multimodal transport', website: 'https://bloxmove.com', linkedin: 'https://linkedin.com/company/bloxmove', twitter: 'https://twitter.com/bloxmove' },
  { slug: 'xylene', name: 'Xylene GmbH', sector: 'Infrastructure', location: 'Germany', description: 'Web3 development infrastructure and tooling', website: 'https://xylene.io', linkedin: '', twitter: '' },
  { slug: 'busha', name: 'Busha Ltd', sector: 'Exchange', location: 'Lagos, Nigeria', description: 'Nigerian cryptocurrency exchange and trading platform', website: 'https://busha.io', linkedin: 'https://linkedin.com/company/busha', twitter: 'https://twitter.com/AskBusha' },
  { slug: 'staex', name: 'Staex GmbH', sector: 'Infrastructure', location: 'Berlin, Germany', description: 'Secure connectivity platform for IoT and edge computing', website: 'https://staex.io', linkedin: 'https://linkedin.com/company/staex', twitter: '' },
  { slug: 'saltox', name: 'Salto X', sector: 'DeFi', location: '', description: 'Decentralized trading and DeFi platform', website: 'https://saltox.co', linkedin: '', twitter: '' },
  { slug: 'blinklabs', name: 'Blink Labs', sector: 'Infrastructure', location: '', description: 'Developer tools and infrastructure for Cardano blockchain', website: 'https://blinklabs.xyz', linkedin: '', twitter: 'https://twitter.com/blaboratories' },
  { slug: 'spiko', name: 'Spiko SAS', sector: 'Tokenization', location: 'France', description: 'Tokenized money market funds on blockchain', website: 'https://spiko.io', linkedin: 'https://linkedin.com/company/spiko', twitter: '' },
  { slug: 'zealy', name: 'Zealy', sector: 'Community', location: 'France', description: 'Community engagement and quest platform for Web3 projects', website: 'https://zealy.io', linkedin: 'https://linkedin.com/company/zealy-io', twitter: 'https://twitter.com/zealy_io' },
  { slug: 'validationcloud', name: 'Validation Cloud', sector: 'Infrastructure', location: 'Switzerland', description: 'Enterprise-grade Web3 infrastructure and node services', website: 'https://validationcloud.io', linkedin: 'https://linkedin.com/company/validationcloud', twitter: 'https://twitter.com/ValidationCloud' },
  { slug: 'opfn', name: 'Opfn', sector: 'Infrastructure', location: '', description: 'Decentralized compute and network infrastructure', website: 'https://opfn.co', linkedin: '', twitter: '' },
  { slug: 'spherity', name: 'Spherity GmbH', sector: 'Identity', location: 'Dortmund, Germany', description: 'Decentralized identity solutions for enterprises', website: 'https://spherity.com', linkedin: 'https://linkedin.com/company/spherity', twitter: 'https://twitter.com/spherity' },
  { slug: 'tlon', name: 'TLON Corporation', sector: 'Infrastructure', location: 'USA', description: 'Urbit development company building decentralized personal computing', website: 'https://tlon.io', linkedin: '', twitter: 'https://twitter.com/tloncorporation' },
  { slug: 'nilos', name: 'Nilos', sector: 'Payments', location: '', description: 'Stablecoin and digital currency infrastructure for businesses', website: 'https://nilos.io', linkedin: '', twitter: '' },
  { slug: 'tranched', name: 'Tranched', sector: 'DeFi', location: '', description: 'Decentralized credit and structured finance protocols', website: 'https://tranched.fi', linkedin: '', twitter: '' },
  { slug: 'river', name: 'River Platform', sector: 'Infrastructure', location: '', description: 'Decentralized protocol for Web3 applications', website: 'https://getriver.io', linkedin: '', twitter: '' },
  { slug: 'byzantine', name: 'Byzantine Finance', sector: 'DeFi', location: 'France', description: 'Restaking and liquid staking infrastructure', website: 'https://byzantine.fi', linkedin: '', twitter: '' },
  { slug: 'rebind', name: 'Rebind', sector: 'Infrastructure', location: 'France', description: 'Web3 data infrastructure and indexing', website: 'https://rebind.co', linkedin: '', twitter: '' },
  { slug: 'kirha', name: 'Kirha', sector: 'AI', location: 'France', description: 'AI-powered agents and automation for Web3', website: 'https://kirha.ai', linkedin: '', twitter: '' },
  { slug: 'blu', name: 'Blu Financiero', sector: 'Payments', location: 'Latin America', description: 'Crypto-powered financial services for Latin America', website: 'https://blufinanciero.com', linkedin: '', twitter: '' },
  { slug: 'spectarium', name: 'Spectarium', sector: 'Gaming', location: 'Finland', description: 'Web3 gaming studio and infrastructure', website: 'https://spectarium.games', linkedin: '', twitter: '' },
  { slug: 'kulipa', name: 'Kulipa', sector: 'Payments', location: '', description: 'Crypto debit cards and payment solutions', website: 'https://kulipa.xyz', linkedin: '', twitter: '' },
  { slug: 'den', name: 'Den Technologies', sector: 'Infrastructure', location: '', description: 'On-chain treasury and multisig management', website: 'https://onchainden.com', linkedin: '', twitter: '' },
  { slug: 'yousend', name: 'Yousend', sector: 'Payments', location: '', description: 'Crypto-powered remittance and money transfer', website: 'https://yousend.co', linkedin: '', twitter: '' },
  { slug: 'flyra', name: 'Flyra', sector: 'Infrastructure', location: '', description: 'Web3 payments infrastructure', website: 'https://flyra.com', linkedin: '', twitter: '' }
];

function generateCompanyPage(company) {
  const initials = company.name.substring(0, 2).toUpperCase();
  const links = [];
  if (company.website) links.push(`<a href="${company.website}" target="_blank" class="company-ext-link">Website &rarr;</a>`);
  if (company.linkedin) links.push(`<a href="${company.linkedin}" target="_blank" class="company-ext-link">LinkedIn &rarr;</a>`);
  if (company.twitter) links.push(`<a href="${company.twitter}" target="_blank" class="company-ext-link">Twitter &rarr;</a>`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${company.name} | Portfolio Companies | Blockwall Insights</title>
  <link rel="icon" type="image/png" href="../../assets/images/blockwall-logo.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../../assets/css/main.css">
  <style>
    .company-hero-card {
      background: var(--glass-bg);
      backdrop-filter: blur(var(--glass-blur));
      -webkit-backdrop-filter: blur(var(--glass-blur));
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-xl);
      padding: var(--space-xl);
      margin-bottom: var(--space-xl);
      display: flex;
      align-items: center;
      gap: var(--space-xl);
    }
    .company-logo-large {
      width: 80px;
      height: 80px;
      border-radius: var(--radius-lg);
      background: linear-gradient(135deg, var(--bw-accent-muted), rgba(168, 85, 247, 0.25));
      border: 1px solid var(--glass-border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      color: var(--text-primary);
      font-size: 1.5rem;
      flex-shrink: 0;
    }
    .company-info h1 {
      font-size: 24px;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 8px;
      letter-spacing: -0.02em;
    }
    .company-sector-badge {
      display: inline-block;
      background: var(--bw-accent);
      color: white;
      padding: 4px 12px;
      border-radius: 100px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }
    .company-description {
      color: var(--text-muted);
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 12px;
    }
    .company-location {
      color: var(--text-dim);
      font-size: 13px;
      margin-bottom: 12px;
    }
    .company-ext-links {
      display: flex;
      gap: var(--space-md);
      flex-wrap: wrap;
    }
    .company-ext-link {
      color: var(--bw-accent-bright);
      font-size: 13px;
      font-weight: 500;
      transition: color var(--transition-fast);
    }
    .company-ext-link:hover {
      color: var(--text-primary);
    }
    .company-stats {
      padding: 0 0 var(--space-xl);
    }
    .updates-section-title {
      font-size: 20px;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: var(--space-md);
      letter-spacing: -0.02em;
    }
    .timeline-item {
      background: var(--bw-card);
      border: 1px solid var(--bw-border);
      border-radius: var(--radius-md);
      padding: var(--space-lg);
      margin-bottom: var(--space-md);
      border-left: 3px solid var(--bw-accent);
      transition: all var(--transition-base);
    }
    .timeline-item:hover {
      border-color: var(--bw-border-light);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    }
    .timeline-date {
      color: var(--bw-accent-bright);
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .timeline-title {
      color: var(--text-primary);
      font-weight: 600;
      font-size: 15px;
      margin-bottom: 8px;
      line-height: 1.4;
    }
    .timeline-title a {
      color: inherit;
      text-decoration: none;
      transition: color var(--transition-fast);
    }
    .timeline-title a:hover {
      color: var(--bw-accent-bright);
    }
    .timeline-meta {
      color: var(--text-dim);
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }
    .timeline-summary {
      color: var(--text-muted);
      font-size: 13px;
      line-height: 1.5;
    }
    .sentiment-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      font-size: 11px;
      font-weight: 600;
    }
    .sentiment-badge.bullish { background: rgba(16, 185, 129, 0.15); color: var(--bw-green); }
    .sentiment-badge.bearish { background: rgba(239, 68, 68, 0.15); color: var(--bw-red); }
    .sentiment-badge.neutral { background: rgba(136, 144, 160, 0.15); color: var(--text-muted); }
    .empty-updates {
      text-align: center;
      padding: var(--space-2xl);
      color: var(--text-muted);
      background: var(--bw-card);
      border: 1px solid var(--bw-border);
      border-radius: var(--radius-lg);
      font-size: 14px;
    }
    .empty-updates h3 {
      color: var(--text-primary);
      font-size: 16px;
      margin-bottom: 8px;
    }
    @media (max-width: 768px) {
      .company-hero-card {
        flex-direction: column;
        text-align: center;
        padding: var(--space-lg);
      }
      .company-ext-links {
        justify-content: center;
      }
    }
  </style>
</head>
<body data-theme="dark">
  <nav class="nav">
    <div class="nav-inner">
      <a href="../../index.html" class="nav-brand">
        <img src="../../assets/images/blockwall-logo.png" alt="Blockwall" class="nav-logo">
        <span class="nav-brand-text">Blockwall Insights</span>
      </a>
      <div class="nav-links">
        <a href="../../daily/index.html" class="nav-link">Daily</a>
        <a href="../../weekly/index.html" class="nav-link">Weekly</a>
        <a href="../../monthly/index.html" class="nav-link">Monthly</a>
        <a href="../index.html" class="nav-link active">Portfolio</a>
      </div>
      <button class="theme-toggle" onclick="toggleTheme()" aria-label="Toggle theme">
        <span id="theme-icon">🌙</span>
      </button>
    </div>
  </nav>

  <main class="archive-container">
    <a href="../index.html" class="back-link">
      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
      Back to Portfolio
    </a>

    <div class="company-hero-card">
      <div class="company-logo-large">${initials}</div>
      <div class="company-info">
        <h1>${company.name}</h1>
        <span class="company-sector-badge">${company.sector}</span>
        ${company.location ? `<p class="company-location">${company.location}</p>` : ''}
        <p class="company-description">${company.description}</p>
        <div class="company-ext-links">
          ${links.join('\n          ')}
        </div>
      </div>
    </div>

    <div class="company-stats">
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-value" id="total-updates">&mdash;</div>
          <div class="stat-label">Total Updates</div>
        </div>
        <div class="stat-item">
          <div class="stat-value" id="bullish-count">&mdash;</div>
          <div class="stat-label">Bullish</div>
        </div>
        <div class="stat-item">
          <div class="stat-value" id="bearish-count">&mdash;</div>
          <div class="stat-label">Bearish</div>
        </div>
        <div class="stat-item">
          <div class="stat-value" id="latest-date">&mdash;</div>
          <div class="stat-label">Latest Update</div>
        </div>
      </div>
    </div>

    <h2 class="updates-section-title">News &amp; Updates</h2>
    <div id="updates-container">
      <div class="empty-updates">
        <h3>Tracking Active</h3>
        <p>No news found yet for ${company.name}. Updates will appear here as they're discovered.</p>
        <p style="margin-top: 8px; font-size: 13px; color: var(--text-dim);">Portfolio tracking runs daily at 6:00 UTC.</p>
      </div>
    </div>
  </main>

  <footer class="footer">
    <div class="footer-inner">
      <div class="footer-brand">
        <img src="../../assets/images/blockwall-logo.png" alt="Blockwall" class="footer-logo">
        <span>Blockwall Capital</span>
      </div>
      <p class="footer-text">European Crypto Venture Capital &bull; Frankfurt, Germany</p>
      <div class="footer-links">
        <a href="https://blockwall.vc" target="_blank" class="footer-link">Website</a>
        <a href="https://linkedin.com/company/blockwall" target="_blank" class="footer-link">LinkedIn</a>
        <a href="https://x.com/blockwall_vc" target="_blank" class="footer-link">Twitter</a>
        <a href="https://insights.blockwall.vc" target="_blank" class="footer-link">Substack</a>
      </div>
    </div>
  </footer>

  <script>
    function toggleTheme() {
      const body = document.body;
      const icon = document.getElementById('theme-icon');
      if (body.getAttribute('data-theme') === 'dark') {
        body.setAttribute('data-theme', 'light');
        icon.textContent = '\u2600\uFE0F';
        localStorage.setItem('bw-theme', 'light');
      } else {
        body.setAttribute('data-theme', 'dark');
        icon.textContent = '\uD83C\uDF19';
        localStorage.setItem('bw-theme', 'dark');
      }
    }
    const savedTheme = localStorage.getItem('bw-theme') || 'dark';
    document.body.setAttribute('data-theme', savedTheme);
    document.getElementById('theme-icon').textContent = savedTheme === 'dark' ? '\uD83C\uDF19' : '\u2600\uFE0F';

    const slug = '${company.slug}';

    async function loadCompanyUpdates() {
      const container = document.getElementById('updates-container');
      try {
        const response = await fetch(\`../../data/portfolio/indexes/by-company/\${slug}.json\`);
        if (!response.ok) throw new Error('No data');
        const data = await response.json();
        const items = data.items || [];

        document.getElementById('total-updates').textContent = items.length;
        document.getElementById('bullish-count').textContent = items.filter(i => i.sentiment === 'bullish').length;
        document.getElementById('bearish-count').textContent = items.filter(i => i.sentiment === 'bearish').length;

        if (items.length > 0) {
          const latestDate = new Date(items[0].date_published);
          document.getElementById('latest-date').textContent = latestDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

          container.innerHTML = items.map(item => \`
            <div class="timeline-item">
              <div class="timeline-date">\${formatDate(item.date_published)}</div>
              <div class="timeline-title">
                <a href="\${item.url}" target="_blank">\${escapeHtml(item.title)}</a>
              </div>
              <div class="timeline-meta">
                <span>\${escapeHtml(item.source_name || 'News')}</span>
                <span class="sentiment-badge \${item.sentiment}">\${getSentimentLabel(item.sentiment)}</span>
                <span>Score: \${item.significance_score || 5}/10</span>
              </div>
              \${item.summary_short ? \`<p class="timeline-summary">\${escapeHtml(item.summary_short)}</p>\` : ''}
            </div>
          \`).join('');
        }
      } catch (e) {
        document.getElementById('total-updates').textContent = '0';
        document.getElementById('bullish-count').textContent = '0';
        document.getElementById('bearish-count').textContent = '0';
        document.getElementById('latest-date').textContent = 'N/A';
      }
    }

    function formatDate(dateStr) {
      try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
      } catch (e) { return dateStr; }
    }

    function getSentimentLabel(sentiment) {
      const labels = { bullish: 'Bullish', bearish: 'Bearish', neutral: 'Neutral' };
      return labels[sentiment] || 'Neutral';
    }

    function escapeHtml(str) {
      if (!str) return '';
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    loadCompanyUpdates();
  </script>
</body>
</html>`;
}

function main() {
  const outputDir = path.join(__dirname, '..', 'portfolio', 'companies');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('Generating company pages...\\n');

  for (const company of companies) {
    const html = generateCompanyPage(company);
    const outputPath = path.join(outputDir, `${company.slug}.html`);
    fs.writeFileSync(outputPath, html, 'utf8');
    console.log(`Generated: ${company.slug}.html`);
  }

  console.log(`\\nGenerated ${companies.length} company pages in ${outputDir}`);
}

main();
