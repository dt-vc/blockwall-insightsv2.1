#!/usr/bin/env node
/**
 * Portfolio Collision Validator  —  Blockwall Insights
 * ----------------------------------------------------------------------------
 * Decides whether a candidate item (a blog post, sitemap entry, or — the risky
 * one — a Google-News hit) genuinely belongs to a given portfolio company.
 *
 * Why it exists: the collector pulls Google News per company, and several
 * companies have generic single-word names (River, Den, Blu, Blink, Flyra).
 * A bare-name match would ingest the WRONG company's news ($RIVER token, "Den
 * of Thieves", Justin Sun rounds…). This gate accepts only on a trustworthy
 * signal and rejects bare-generic-name matches.
 *
 * Acceptance rules (first match wins):
 *   1. on-domain        — item URL is on the company's domain or a trusted
 *                         source host (its Substack/Medium/Ghost-subdomain feed).
 *                         Feed & sitemap items always pass here.
 *   2. domain-mention   — the company domain (e.g. "getriver.io") appears in text.
 *   3. root-mention     — the distinctive domain root (e.g. "getriver", len>=5)
 *                         appears as a whole word.
 *   4. strong-identifier— a NON-generic identifier appears: a domain, a
 *                         multi-word phrase ("validation cloud"), or a long token
 *                         ("blufinanciero").
 * Otherwise REJECT. If the only thing that matched was a weak/generic name, the
 * reason is "weak-match-only:<word>" so contamination attempts are visible in logs.
 *
 * IMPORTANT: the validator is only as good as the registry identifiers. If a
 * company's identifiers describe the wrong entity (e.g. River currently lists
 * "towns app"/"ben rubin river"), clean them in the registry first — this gate
 * trusts whatever identifiers it's given.
 *
 * Usage (integration):
 *   const { buildValidators } = require('./portfolio-validate');
 *   const validators = buildValidators(
 *     JSON.parse(fs.readFileSync('data/portfolio/companies.json','utf8')),
 *     { river: ['irlurl.substack.com'], busha: ['blog.busha.io'], ... }  // trusted hosts per slug
 *   );
 *   const v = validators[slug];
 *   const { ok, reason } = v({ url, title, summary, publisher });
 *   if (!ok) { /* drop it, optionally log reason *\/ }
 *
 * Usage (test):  node portfolio-validate.js --selftest
 *
 * Node 18+. Zero dependencies. Pure functions — no network, no I/O (except the
 * optional registry read the caller does).
 */
'use strict';

function norm(s) { return String(s == null ? '' : s).toLowerCase(); }
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
    catch { return ''; }
}
function domainRoot(domain) {
    return String(domain || '').replace(/^www\./, '').split('.')[0].toLowerCase();
}

// A "strong" identifier is safe to accept from an off-domain (news) source.
// Strong: looks like a domain (has a dot), is multi-word, or is a long single
// token. Weak: a short single word ("river", "den", "blu") — never accepted alone.
function isStrongIdentifier(id) {
    const t = norm(id).trim();
    if (!t) return false;
    if (t.includes('.')) return true;   // domain, e.g. getriver.io
    if (/\s/.test(t)) return true;      // multi-word, e.g. "validation cloud"
    if (t.length >= 10) return true;    // long token, e.g. "blufinanciero"
    return false;                       // short single word -> generic
}

/**
 * company: { slug, name, domain, identifiers[] }
 * trustedHosts: string[] — extra hosts that are definitively this company
 *               (e.g. its Substack/Medium/blog-subdomain feed host)
 */
function makeValidator(company, trustedHosts = []) {
    const domain = norm(company && company.domain);
    const root = domainRoot(domain);
    const ids = ((company && company.identifiers) || []).map(norm).filter(Boolean);
    const strongIds = ids.filter(isStrongIdentifier);
    const weakIds = ids.filter(id => !isStrongIdentifier(id));
    const trusted = [domain, ...trustedHosts.map(norm)].filter(Boolean);
    const rootRe = root && root.length >= 5 ? new RegExp(`\\b${escapeRe(root)}\\b`) : null;
    const weakRes = weakIds.map(id => ({ id, re: new RegExp(`\\b${escapeRe(id)}\\b`) }));

    function onTrustedHost(url) {
        const h = hostOf(url);
        if (!h) return false;
        return trusted.some(t => h === t || h.endsWith('.' + t));
    }

    // Founder / person-name identifiers (registry .founders) are "body-safe": a story naming a
    // specific person is almost always ABOUT their company, so these may match in the article
    // BODY sample too (recovers coverage that names the company only as "Den" in the headline but
    // the founder in the body). Everything else — domain, company name, product token — is
    // co-mention-prone (fintech roundups link rivals) and matches in CORE text only. Populate
    // .founders ONLY with names that don't collide with a namesake (we deliberately excluded
    // Casper Yonel, Oneal Bhambani, Adeoye Ojo, Jonah Erlich for exactly that reason).
    const founders = ((company && company.founders) || []).map(norm).filter(Boolean);

    return function validate(item) {
        const url = (item && item.url) || '';
        // core = headline/description/publisher/url (reliable). body = a capped article-body
        // sample supplied for off-domain NEWS items (co-mention-prone → founder names only).
        const core = norm([item && item.title, item && item.summary, item && item.publisher, url].join(' '));
        const body = norm(item && item.matchText);

        if (onTrustedHost(url)) return { ok: true, reason: 'on-domain', signal: hostOf(url) };
        if (domain && core.includes(domain)) return { ok: true, reason: 'domain-mention', signal: domain };
        if (rootRe && rootRe.test(core)) return { ok: true, reason: 'root-mention', signal: root };
        for (const sid of strongIds) { if (core.includes(sid)) return { ok: true, reason: 'strong-identifier', signal: sid }; }
        for (const f of founders) {
            if (core.includes(f)) return { ok: true, reason: 'founder', signal: f };
            if (body.includes(f)) return { ok: true, reason: 'founder-body', signal: f };
        }
        const weak = weakRes.find(w => w.re.test(core));
        return { ok: false, reason: weak ? `weak-match-only:${weak.id}` : 'no-match', signal: weak ? weak.id : null };
    };
}

/**
 * Build a { slug -> validate } map from the companies.json registry.
 * registry: the parsed companies.json (object with .companies[] or a bare array)
 * trustedHostsBySlug: optional { slug: [host, …] }
 */
function buildValidators(registry, trustedHostsBySlug = {}) {
    const list = Array.isArray(registry) ? registry : (registry.companies || registry.portfolio || []);
    const out = {};
    for (const c of list) {
        if (!c || !c.slug) continue;
        out[c.slug] = makeValidator(c, trustedHostsBySlug[c.slug] || []);
    }
    return out;
}

module.exports = { makeValidator, buildValidators, isStrongIdentifier, hostOf, domainRoot };

// ── offline self-test ────────────────────────────────────────────────────────
function selftest() {
    let pass = 0, fail = 0;
    const A = (label, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); cond ? pass++ : fail++; };

    // River AFTER registry cleanup: domain + multi-word product identifiers, no "towns"/"ben rubin"
    const river = makeValidator(
        {
            slug: 'river', name: 'River Platform Company', domain: 'getriver.io',
            identifiers: ['getriver.io', 'the current by river', 'river meetups']
        },
        ['irlurl.substack.com']
    );
    A('river: own domain accepted',
        river({ url: 'https://getriver.io/blog/x', title: 'A post' }).reason === 'on-domain');
    A('river: substack (trusted host) accepted',
        river({ url: 'https://irlurl.substack.com/p/hello', title: 'Hello' }).ok === true);
    A('river: news mentioning domain accepted',
        river({ url: 'https://techcrunch.com/x', title: 'getriver.io raises seed' }).reason === 'domain-mention');
    A('river: news with product phrase accepted',
        river({ url: 'https://news.site/x', title: 'The Current by River expands to Berlin' }).reason === 'strong-identifier');
    A('river: $RIVER token / Justin Sun news REJECTED',
        river({ url: 'https://cointelegraph.com/x', title: 'River protocol token surges as Justin Sun buys in' }).ok === false);
    A('river: River Financial namesake REJECTED',
        river({ url: 'https://coindesk.com/x', title: 'River Financial adds bitcoin lending' }).ok === false);

    // A company that DOES carry a weak generic identifier -> the dangerous case
    const den = makeValidator(
        {
            slug: 'den', name: 'Den Technologies', domain: 'onchainden.com',
            identifiers: ['onchainden.com', 'den', 'safe multisig']
        }
    );
    A('den: own domain accepted',
        den({ url: 'https://onchainden.com/blog/a', title: 'x' }).reason === 'on-domain');
    A('den: domain mentioned in news accepted',
        den({ url: 'https://dev.to/x', title: 'onchainden.com partners with Zeeve' }).reason === 'domain-mention');
    A('den: bare "Den of Thieves" REJECTED as weak-match-only',
        den({ url: 'https://variety.com/x', title: 'Den of Thieves 2 box office' }).reason === 'weak-match-only:den');

    // Multi-word strong identifier
    const vc = makeValidator(
        {
            slug: 'validationcloud', name: 'Validation Cloud AG', domain: 'validationcloud.io',
            identifiers: ['validationcloud.io', 'validation cloud', 'mavrik-1']
        }
    );
    A('vc: news with multi-word identifier accepted',
        vc({ url: 'https://theblock.co/x', title: 'Validation Cloud raises $5.8M' }).reason === 'strong-identifier');

    // isStrongIdentifier unit checks
    A('strong: domain', isStrongIdentifier('getriver.io') === true);
    A('strong: multi-word', isStrongIdentifier('validation cloud') === true);
    A('strong: long token', isStrongIdentifier('blufinanciero') === true);
    A('weak: short word', isStrongIdentifier('river') === false);

    // buildValidators from a registry object
    const vals = buildValidators(
        { companies: [{ slug: 'spiko', name: 'Spiko SAS', domain: 'spiko.io', identifiers: ['spiko.io', 'spiko sas'] }] },
        { spiko: ['spiko.io'] }
    );
    A('buildValidators wires slug', typeof vals.spiko === 'function');
    A('buildValidators on-domain works',
        vals.spiko({ url: 'https://www.spiko.io/blog/treasury', title: 'x' }).ok === true);

    console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'} (${pass}/${pass + fail})`);
    process.exit(fail === 0 ? 0 : 1);
}

if (require.main === module && process.argv.includes('--selftest')) selftest();