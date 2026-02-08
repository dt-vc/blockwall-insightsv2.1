# Portfolio Data Architecture

## Directory Structure

```
data/portfolio/
├── companies.json          # Master company registry
├── blog/                   # Pre-generated blog posts per company
│   ├── busha.json
│   ├── spiko.json
│   └── ...
├── indexes/
│   ├── latest.json         # Raw news items (may contain false positives)
│   ├── latest-validated.json # Validated news with match_reason
│   ├── peerintel-latest.json
│   └── dealflow.json
└── README.md               # This file
```

## Verification Checklist

### 1. How to Confirm No Name Collisions

For each news item, verify it passes the strict matching rules:

**Accept if ANY of these conditions are true:**
1. **Source domain matches company domain**
   - Example: Article from `busha.io/blog/*` matches Busha

2. **Article contains company name AND company domain**
   - Example: "Busha (busha.io) launches new feature" → ACCEPT

3. **Article contains company name AND an identifier from `identifiers[]`**
   - Example: "Towns app by River Protocol" → ACCEPT (contains "towns" identifier)

**Reject if:**
- Article is about a cryptocurrency token with the same name (e.g., "$RIVER" token)
- Article mentions the company name but no domain/identifier (generic name collision)
- Article is about an unrelated entity with similar name

**Validation Script:**
```javascript
function validateMatch(item, company) {
  const title = item.title.toLowerCase();
  const url = item.url.toLowerCase();

  // Rule 1: Source domain matches
  if (url.includes(company.domain)) return { valid: true, reason: 'source_domain_match' };

  // Rule 2: Title contains name AND domain
  if (title.includes(company.name.toLowerCase()) && title.includes(company.domain)) {
    return { valid: true, reason: 'title_contains_name_and_domain' };
  }

  // Rule 3: Title contains name AND identifier
  for (const id of company.identifiers) {
    if (title.includes(id.toLowerCase())) {
      return { valid: true, reason: `title_contains_identifier_${id}` };
    }
  }

  return { valid: false, reason: 'no_match' };
}
```

### 2. How to Verify Blog Feeds Render Correctly

1. **Check blog JSON files exist:**
   ```bash
   ls data/portfolio/blog/
   ```

2. **Verify JSON structure:**
   ```bash
   cat data/portfolio/blog/busha.json | jq '.posts[0]'
   ```

   Each post should have:
   - `id`: Unique identifier
   - `title`: Post title
   - `url`: Link to full article
   - `date_published`: ISO date string
   - `excerpt`: 1-2 sentence summary
   - `author`: (optional) Author name

3. **Test in browser:**
   - Open `/portfolio/companies/busha.html`
   - Verify "Latest Blog Posts" section renders
   - Click links to verify they work

4. **Check for empty states:**
   - Companies without blog data should show "No blog posts available"

### 3. How to Add a New Company Safely

1. **Add to `companies.json`:**
   ```json
   {
     "slug": "newcompany",
     "name": "New Company Inc",
     "sector": "DeFi",
     "industry": "Financial Services - Category",
     "status": "Active",
     "website": "https://newcompany.io",
     "domain": "newcompany.io",
     "linkedin_url": "https://www.linkedin.com/company/newcompany/",
     "identifiers": ["newcompany.io", "unique-product-name", "founder-name"],
     "rss_urls": ["https://newcompany.io/blog/rss"],
     "logo": "newcompany.png",
     "description": "Brief description of the company."
   }
   ```

2. **Add company logo:**
   - Place logo at `assets/companies/newcompany.png`
   - Recommended size: 200x200px, PNG with transparency

3. **Create blog data file (if applicable):**
   ```bash
   cp data/portfolio/blog/_default.json data/portfolio/blog/newcompany.json
   ```
   Then populate with actual blog posts.

4. **Generate company page:**
   ```bash
   python3 scripts/generate_company_pages.py
   ```
   Or manually create `/portfolio/companies/newcompany.html`

5. **Verify:**
   - [ ] Company appears in portfolio grid
   - [ ] LinkedIn icon links correctly
   - [ ] Status badge shows correct color
   - [ ] Company detail page loads
   - [ ] Blog posts render (if available)
   - [ ] News mentions are validated (no false positives)

## Matching Rules Reference

### Company Identifiers

Each company has an `identifiers[]` array in `companies.json` containing:
- Official domain (e.g., "busha.io")
- LinkedIn company slug (e.g., "getbusha")
- Product names (e.g., "towns" for River)
- Unique brand terms
- Founder names (if publicly associated)

### False Positive Examples

| Company | False Positive | Reason |
|---------|---------------|--------|
| River | "How To Buy River In INR?" | About $RIVER cryptocurrency token |
| TLON | "Far-right blogger..." | Unrelated person named Curtis Yarvin |
| Blink Labs | Generic "Blink" mentions | Common word, needs "cardano" or "blinklabs" |

### Validated News Format

`latest-validated.json` includes `match_reason` for debugging:
```json
{
  "id": "...",
  "company_slug": "busha",
  "title": "Busha launches new identity...",
  "match_reason": "title_contains_name_and_domain_context"
}
```

## Data Pipeline

1. **Collection**: Raw news fetched and stored in `latest.json`
2. **Validation**: Apply matching rules, output to `latest-validated.json`
3. **Blog Posts**: Pre-fetched from RSS feeds, stored in `blog/*.json`
4. **Display**: Company pages load from validated JSON files

## Maintenance

- Update `companies.json` when company status changes
- Refresh blog posts periodically (weekly recommended)
- Review `latest.json` for new false positive patterns
- Add new identifiers when needed for better matching
