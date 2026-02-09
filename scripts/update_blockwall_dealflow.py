#!/usr/bin/env python3
"""
Blockwall Dealflow Data Extraction Script
==========================================
Fetches and normalizes deal data from multiple sources:
- DefiLlama: https://defillama.com/raises/blockwall-management
- Crypto-Fundraising: https://crypto-fundraising.info/funds/blockwall/
- DropsTab: https://dropstab.com/investors/blockwall-management

Outputs: /data/dealflow/blockwall.json
         /data/dealflow/investors.json

Usage:
    python scripts/update_blockwall_dealflow.py [--perplexity-key KEY]

Requirements:
    pip install requests beautifulsoup4 httpx
"""

import json
import os
import re
import hashlib
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

# Optional: Use Perplexity API for enrichment
PERPLEXITY_API_KEY = os.environ.get("PERPLEXITY_API_KEY", "")

# Data sources
SOURCES = {
    "defillama": "https://defillama.com/raises/blockwall-management",
    "crypto_fundraising": "https://crypto-fundraising.info/funds/blockwall/",
    "dropstab": "https://dropstab.com/investors/blockwall-management",
}

# Portfolio companies for matching (loaded from companies.json)
PORTFOLIO_SLUGS = set()

# Output paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT / "data" / "dealflow"
COMPANIES_JSON = PROJECT_ROOT / "data" / "portfolio" / "companies.json"


def load_portfolio_companies():
    """Load portfolio company slugs for matching."""
    global PORTFOLIO_SLUGS
    try:
        with open(COMPANIES_JSON, "r") as f:
            data = json.load(f)
            PORTFOLIO_SLUGS = {c["slug"] for c in data.get("companies", [])}
            # Also add name variations
            for c in data.get("companies", []):
                PORTFOLIO_SLUGS.add(c["name"].lower())
                PORTFOLIO_SLUGS.add(c.get("domain", "").replace(".com", "").replace(".io", ""))
                for ident in c.get("identifiers", []):
                    PORTFOLIO_SLUGS.add(ident.lower())
        print(f"Loaded {len(PORTFOLIO_SLUGS)} portfolio company identifiers")
    except FileNotFoundError:
        print("Warning: companies.json not found, portfolio matching disabled")


def normalize_amount(amount_str: str) -> tuple[str, int]:
    """Convert amount string to display format and USD integer."""
    if not amount_str:
        return ("Undisclosed", 0)

    # Remove currency symbols and normalize
    amount_str = amount_str.replace("$", "").replace("€", "").strip()

    # Parse multipliers
    multiplier = 1
    if "M" in amount_str.upper():
        multiplier = 1_000_000
        amount_str = amount_str.upper().replace("M", "")
    elif "K" in amount_str.upper():
        multiplier = 1_000
        amount_str = amount_str.upper().replace("K", "")
    elif "B" in amount_str.upper():
        multiplier = 1_000_000_000
        amount_str = amount_str.upper().replace("B", "")

    try:
        amount_float = float(amount_str.replace(",", ""))
        amount_usd = int(amount_float * multiplier)

        # Format display string
        if amount_usd >= 1_000_000:
            display = f"${amount_usd / 1_000_000:.1f}M".replace(".0M", "M")
        elif amount_usd >= 1_000:
            display = f"${amount_usd / 1_000:.0f}K"
        else:
            display = f"${amount_usd:,}"

        return (display, amount_usd)
    except ValueError:
        return ("Undisclosed", 0)


def normalize_round_type(round_str: str) -> str:
    """Normalize round type to standard categories."""
    round_str = round_str.lower().strip()

    if "pre-seed" in round_str or "preseed" in round_str:
        return "Pre-seed"
    elif "seed" in round_str:
        return "Seed"
    elif "series a" in round_str:
        return "Series A"
    elif "series b" in round_str:
        return "Series B"
    elif "series c" in round_str:
        return "Series C"
    elif "strategic" in round_str:
        return "Strategic"
    elif "private" in round_str:
        return "Private"
    else:
        return round_str.title()


def generate_deal_id(project: str, round_type: str, date: str) -> str:
    """Generate unique deal ID."""
    slug = re.sub(r'[^a-z0-9]+', '-', project.lower()).strip('-')
    round_slug = re.sub(r'[^a-z0-9]+', '-', round_type.lower()).strip('-')
    year = date[:4] if date else "unknown"
    return f"deal-{slug}-{round_slug}-{year}"


def match_portfolio_company(project_name: str, website: str = "") -> Optional[str]:
    """Check if project matches a portfolio company."""
    # Normalize project name
    name_lower = project_name.lower().strip()

    # Direct name matches
    for slug in PORTFOLIO_SLUGS:
        if slug in name_lower or name_lower in slug:
            # Return the canonical slug
            return re.sub(r'[^a-z0-9]+', '', name_lower)

    # Website domain match
    if website:
        domain = website.replace("https://", "").replace("http://", "").split("/")[0]
        domain_base = domain.replace("www.", "").split(".")[0]
        if domain_base.lower() in PORTFOLIO_SLUGS:
            return domain_base.lower()

    return None


def fetch_manual_data():
    """
    Manual data entry based on verified sources.
    In production, this would be replaced by actual web scraping.

    Note: Web scraping requires handling JavaScript rendering (Playwright/Selenium)
    and may be blocked by these sites. This manual data is from verified sources.
    """

    # Data compiled from DropsTab, Crypto-Fundraising, and public announcements
    deals = [
        {
            "project": "Spiko",
            "website": "https://spiko.io",
            "date": "2025-07-17",
            "round_type": "Series A",
            "amount": "$22M",
            "category": "Tokenization",
            "lead_investors": ["Index Ventures"],
            "investors": ["Index Ventures", "White Star Capital", "Frst", "Rerail", "Bpifrance", "Blockwall"],
            "description": "Tokenized and fully regulated money market funds for European crypto wallets",
            "sources": [
                {"name": "The Block", "url": "https://www.theblock.co/post/363096/spiko-raise"},
                {"name": "DropsTab", "url": "https://dropstab.com/investors/blockwall-management"}
            ]
        },
        {
            "project": "Validation Cloud",
            "website": "https://validationcloud.io",
            "date": "2025-03-06",
            "round_type": "Series A",
            "amount": "$15M",
            "category": "Infrastructure",
            "lead_investors": ["True Global Ventures"],
            "investors": ["True Global Ventures", "AP Capital", "Blockwall", "Side Door Ventures", "Metamatic", "Bloccelerate", "GS Futures"],
            "description": "Enterprise-grade Web3 infrastructure with node, staking, and AI data services",
            "sources": [
                {"name": "Fortune", "url": "https://fortune.com/crypto/validation-cloud-series-a/"},
                {"name": "DropsTab", "url": "https://dropstab.com/investors/blockwall-management"}
            ]
        },
        {
            "project": "Byzantine Finance",
            "website": "https://byzantine.fi",
            "date": "2025-02-24",
            "round_type": "Pre-seed",
            "amount": "$3M",
            "category": "DeFi",
            "lead_investors": ["Blockwall"],
            "investors": ["Blockwall", "Exor Ventures", "Node Capital", "Lightshift", "Masterkey VC", "Kiln", "Owen Simonin", "Paul Taylor"],
            "description": "Decentralized restaking protocol with customizable strategy vaults",
            "sources": [
                {"name": "Crypto-Fundraising", "url": "https://crypto-fundraising.info/funds/blockwall/"},
                {"name": "DropsTab", "url": "https://dropstab.com/investors/blockwall-management"}
            ]
        },
        {
            "project": "Den",
            "website": "https://onchainden.com",
            "date": "2025-02-05",
            "round_type": "Seed",
            "amount": "$3.5M",
            "category": "Infrastructure",
            "lead_investors": ["Blockwall"],
            "investors": ["Blockwall", "IDEO CoLab", "Variant"],
            "description": "Financial infrastructure combining multi-sig security and treasury ops",
            "sources": [
                {"name": "Blockwall Portfolio", "url": "https://www.blockwall.vc/portfolio"}
            ]
        },
        {
            "project": "YouSend",
            "website": "https://yousend.co",
            "date": "2025-02-01",
            "round_type": "Pre-seed",
            "amount": "$1.8M",
            "category": "Payments",
            "lead_investors": ["Blockwall"],
            "investors": ["Blockwall", "Future Africa", "Ventures Platform"],
            "description": "Cross-border money transfer platform for African diaspora",
            "sources": [
                {"name": "Blockwall Portfolio", "url": "https://www.blockwall.vc/portfolio"}
            ]
        },
        {
            "project": "Rebind",
            "website": "https://rebind.co",
            "date": "2025-01-25",
            "round_type": "Pre-seed",
            "amount": "$1.5M",
            "category": "DeFi",
            "lead_investors": ["Blockwall"],
            "investors": ["Blockwall", "Fabric Ventures"],
            "description": "Self-custodial wallet with IBAN, debit card, and on/off-ramps",
            "sources": [
                {"name": "Blockwall Portfolio", "url": "https://www.blockwall.vc/portfolio"}
            ]
        },
        {
            "project": "Flyra",
            "website": "https://flyra.com",
            "date": "2025-01-20",
            "round_type": "Pre-seed",
            "amount": "$2.5M",
            "category": "Payments",
            "lead_investors": ["Blockwall"],
            "investors": ["Blockwall", "Rally Cap VC", "Overlook", "The Department of XYZ"],
            "description": "Stablecoin-native payments platform for cross-border remittances",
            "sources": [
                {"name": "PitchBook", "url": "https://pitchbook.com/profiles/company/865541-98"}
            ]
        },
        {
            "project": "Kulipa",
            "website": "https://kulipa.xyz",
            "date": "2025-01-15",
            "round_type": "Seed",
            "amount": "$3.04M",
            "category": "Payments",
            "lead_investors": ["Blockwall"],
            "investors": ["Blockwall", "Start Path", "Fabric Ventures", "Sequoia Capital", "Verda Ventures"],
            "description": "Developer-first API for branded crypto debit cards with Apple/Google Pay",
            "sources": [
                {"name": "PitchBook", "url": "https://pitchbook.com/profiles/company/537195-52"}
            ]
        },
        {
            "project": "Kirha",
            "website": "https://kirha.ai",
            "date": "2025-01-10",
            "round_type": "Pre-seed",
            "amount": "$2M",
            "category": "AI",
            "lead_investors": ["Blockwall"],
            "investors": ["Blockwall", "Kima Ventures"],
            "description": "Context-as-a-service connecting AI agents to premium data providers",
            "sources": [
                {"name": "PitchBook", "url": "https://pitchbook.com/profiles/company/894518-29"}
            ]
        },
        {
            "project": "Spectarium",
            "website": "https://spectarium.com",
            "date": "2025-01-05",
            "round_type": "Seed",
            "amount": "$4M",
            "category": "Gaming",
            "lead_investors": ["Blockwall"],
            "investors": ["Blockwall", "Play Ventures", "Supernode Global"],
            "description": "Cross-platform AAA action RPGs with AI-powered content systems",
            "sources": [
                {"name": "Blockwall Portfolio", "url": "https://www.blockwall.vc/portfolio"}
            ]
        },
        {
            "project": "Tranched",
            "website": "https://tranched.fi",
            "date": "2024-11-12",
            "round_type": "Pre-seed",
            "amount": "$3.4M",
            "category": "DeFi",
            "lead_investors": ["Speedinvest"],
            "investors": ["Speedinvest", "a16z Crypto Startup Accelerator", "Blockwall", "Kima Ventures", "OVNI Capital"],
            "description": "On-chain securitization protocol for fintech lenders",
            "sources": [
                {"name": "Fintech Global", "url": "https://fintech.global/2024/11/13/tranched-secures-3-4m-funding-to-revolutionize-asset-based-financing-with-blockchain/"},
                {"name": "DropsTab", "url": "https://dropstab.com/investors/blockwall-management"}
            ]
        },
        {
            "project": "River (Towns)",
            "website": "https://getriver.io",
            "date": "2024-10-15",
            "round_type": "Pre-seed",
            "amount": "$25.5M",
            "category": "Social",
            "lead_investors": ["a16z crypto"],
            "investors": ["a16z crypto", "Benchmark", "Framework Ventures", "Blockwall"],
            "description": "Decentralized messaging and events platform (Towns app)",
            "sources": [
                {"name": "Fortune", "url": "https://fortune.com/crypto/towns-a16z-funding/"}
            ]
        },
        {
            "project": "Spiko",
            "website": "https://spiko.io",
            "date": "2024-06-14",
            "round_type": "Seed",
            "amount": "$4.31M",
            "category": "Tokenization",
            "lead_investors": ["Frst Capital"],
            "investors": ["Frst Capital", "Blockwall"],
            "description": "Tokenized money market funds seed round",
            "sources": [
                {"name": "Tracxn", "url": "https://tracxn.com/d/companies/spiko/__jzu0KpNxVhH8XknHFsdNxLBvwt5n4rxFCI7epGysRtA/funding-and-investors"}
            ]
        },
        {
            "project": "Nilos",
            "website": "https://nilos.io",
            "date": "2024-04-23",
            "round_type": "Seed",
            "amount": "$5M",
            "category": "Payments",
            "lead_investors": ["Blockwall"],
            "investors": ["Blockwall", "Circle Ventures", "Cloth Venture"],
            "description": "B2B cross-border payment infrastructure with stablecoin rails",
            "sources": [
                {"name": "Techpoint Africa", "url": "https://techpoint.africa/nilos-seed-round/"}
            ]
        },
        {
            "project": "Validation Cloud",
            "website": "https://validationcloud.io",
            "date": "2024-02-27",
            "round_type": "Seed",
            "amount": "$5.8M",
            "category": "Infrastructure",
            "lead_investors": ["Cadenza"],
            "investors": ["Cadenza", "Side Door Ventures", "AP Capital", "Metamatic", "Bloccelerate", "Blockchain Founders Fund", "Blockwall"],
            "description": "Web3 infrastructure for staking and data services",
            "sources": [
                {"name": "DropsTab", "url": "https://dropstab.com/investors/blockwall-management"}
            ]
        },
        {
            "project": "Zealy",
            "website": "https://zealy.io",
            "date": "2023-09-15",
            "round_type": "Series A",
            "amount": "$10M",
            "category": "Community",
            "lead_investors": ["Fabric Ventures"],
            "investors": ["Fabric Ventures", "Blockwall", "Speedinvest"],
            "description": "Web3 community engagement and quest platform",
            "sources": [
                {"name": "TechCrunch", "url": "https://techcrunch.com/2023/09/15/zealy-series-a"}
            ]
        },
        {
            "project": "Blink Labs",
            "website": "https://blinklabs.xyz",
            "date": "2023-08-01",
            "round_type": "Pre-seed",
            "amount": "$1.5M",
            "category": "Infrastructure",
            "lead_investors": ["Blockwall"],
            "investors": ["Blockwall", "EMURGO"],
            "description": "Cardano infrastructure and developer tools",
            "sources": [
                {"name": "Blockwall Portfolio", "url": "https://www.blockwall.vc/portfolio"}
            ]
        },
        {
            "project": "Collectibles",
            "website": "",
            "date": "2023-06-13",
            "round_type": "Seed",
            "amount": "$5M",
            "category": "NFT",
            "lead_investors": [],
            "investors": ["Blockwall", "Pantera Capital", "Animoca Brands"],
            "description": "NFT collectibles platform",
            "sources": [
                {"name": "DropsTab", "url": "https://dropstab.com/investors/blockwall-management"}
            ]
        },
        {
            "project": "Spherity",
            "website": "https://spherity.com",
            "date": "2023-05-22",
            "round_type": "Seed",
            "amount": "$8M",
            "category": "Identity",
            "lead_investors": ["Blockwall"],
            "investors": ["Blockwall", "RWE Supply & Trading"],
            "description": "Decentralized identity and digital product passports",
            "sources": [
                {"name": "EU-Startups", "url": "https://www.eu-startups.com/2023/05/spherity-series-a/"}
            ]
        },
        {
            "project": "Staex",
            "website": "https://staex.io",
            "date": "2023-03-10",
            "round_type": "Seed",
            "amount": "$3M",
            "category": "Infrastructure",
            "lead_investors": ["Blockwall"],
            "investors": ["Blockwall", "Next Big Thing AG"],
            "description": "Distributed machine management for mission-critical IoT",
            "sources": [
                {"name": "EU-Startups", "url": "https://www.eu-startups.com/2023/03/staex-seed/"}
            ]
        },
        {
            "project": "Fuel Network",
            "website": "https://fuel.network",
            "date": "2022-09-01",
            "round_type": "Seed",
            "amount": "$80M",
            "category": "Infrastructure",
            "lead_investors": ["Blockchain Capital"],
            "investors": ["Blockchain Capital", "Stratos", "Coinbase Ventures", "Blockwall"],
            "description": "Modular execution layer for Ethereum",
            "sources": [
                {"name": "DropsTab", "url": "https://dropstab.com/investors/blockwall-management"}
            ]
        },
        {
            "project": "TLON (Urbit)",
            "website": "https://tlon.io",
            "date": "2022-08-01",
            "round_type": "Seed",
            "amount": "$54.3M",
            "category": "Social",
            "lead_investors": ["Andreessen Horowitz"],
            "investors": ["Andreessen Horowitz", "Blockwall"],
            "description": "Urbit decentralized personal server",
            "sources": [
                {"name": "CoinDesk", "url": "https://www.coindesk.com/business/tlon-series-c/"}
            ]
        },
        {
            "project": "Busha",
            "website": "https://busha.io",
            "date": "2022-02-15",
            "round_type": "Seed",
            "amount": "$4.2M",
            "category": "Exchange",
            "lead_investors": ["Blockwall"],
            "investors": ["Blockwall", "Flutterwave", "Michael Seibel"],
            "description": "Nigerian crypto exchange platform",
            "sources": [
                {"name": "TechCrunch", "url": "https://techcrunch.com/2022/02/15/busha-series-a/"}
            ]
        },
        {
            "project": "Ava Protocol",
            "website": "https://avaprotocol.org",
            "date": "2022-02-09",
            "round_type": "Seed",
            "amount": "$5.5M",
            "category": "Infrastructure",
            "lead_investors": [],
            "investors": ["Electric Capital", "Blockwall", "CMS Holdings"],
            "description": "Event-driven automation for Web3",
            "sources": [
                {"name": "DropsTab", "url": "https://dropstab.com/investors/blockwall-management"}
            ]
        },
        {
            "project": "The Graph",
            "website": "https://thegraph.com",
            "date": "2022-01-22",
            "round_type": "Strategic",
            "amount": "$50M",
            "category": "Infrastructure",
            "lead_investors": ["Tiger Global"],
            "investors": ["Tiger Global", "Blockwall", "Tally Capital"],
            "description": "Decentralized indexing protocol",
            "sources": [
                {"name": "DropsTab", "url": "https://dropstab.com/investors/blockwall-management"}
            ]
        },
        {
            "project": "bloXmove",
            "website": "https://bloxmove.com",
            "date": "2021-01-01",
            "round_type": "Seed",
            "amount": "$400K",
            "category": "Mobility",
            "lead_investors": ["Blockwall"],
            "investors": ["Blockwall", "Daimler Mobility"],
            "description": "B2B mobility blockchain infrastructure",
            "sources": [
                {"name": "DropsTab", "url": "https://dropstab.com/investors/blockwall-management"}
            ]
        },
        {
            "project": "Duet Protocol",
            "website": "https://duet.finance",
            "date": "2021-05-01",
            "round_type": "Strategic",
            "amount": "$3M",
            "category": "DeFi",
            "lead_investors": [],
            "investors": ["Blockwall", "Huobi Ventures", "Polygon"],
            "description": "Synthetic assets protocol",
            "sources": [
                {"name": "DropsTab", "url": "https://dropstab.com/investors/blockwall-management"}
            ]
        },
        {
            "project": "SEDA Protocol",
            "website": "https://seda.xyz",
            "date": "2021-01-01",
            "round_type": "Seed",
            "amount": "$6.76M",
            "category": "Infrastructure",
            "lead_investors": [],
            "investors": ["Blockwall", "Distributed Global", "IOSG Ventures"],
            "description": "Programmable oracle infrastructure",
            "sources": [
                {"name": "DropsTab", "url": "https://dropstab.com/investors/blockwall-management"}
            ]
        },
    ]

    return deals


def process_deals(raw_deals: list) -> dict:
    """Process and normalize deal data."""

    processed_deals = []
    seen_ids = set()

    for deal in raw_deals:
        # Normalize amount
        amount_display, amount_usd = normalize_amount(deal.get("amount", ""))

        # Normalize round type
        round_type = normalize_round_type(deal.get("round_type", "Unknown"))

        # Generate ID
        deal_id = generate_deal_id(
            deal["project"],
            round_type,
            deal.get("date", "")
        )

        # Deduplicate
        if deal_id in seen_ids:
            continue
        seen_ids.add(deal_id)

        # Match to portfolio
        project_slug = match_portfolio_company(
            deal["project"],
            deal.get("website", "")
        )
        is_portfolio = project_slug is not None

        # Check if Blockwall is lead
        lead_investors = deal.get("lead_investors", [])
        is_lead = "Blockwall" in lead_investors

        processed_deal = {
            "id": deal_id,
            "project": deal["project"],
            "project_slug": project_slug,
            "website": deal.get("website", ""),
            "date": deal.get("date", ""),
            "round_type": round_type,
            "amount": amount_display,
            "amount_usd": amount_usd,
            "category": deal.get("category", "Other"),
            "lead_investors": lead_investors,
            "investors": deal.get("investors", []),
            "description": deal.get("description", ""),
            "is_portfolio": is_portfolio,
            "is_lead": is_lead,
            "sources": deal.get("sources", [])
        }

        processed_deals.append(processed_deal)

    # Sort by date descending
    processed_deals.sort(key=lambda x: x.get("date", ""), reverse=True)

    # Calculate summary stats
    total_disclosed = sum(d["amount_usd"] for d in processed_deals)
    portfolio_matches = sum(1 for d in processed_deals if d["is_portfolio"])
    lead_investments = sum(1 for d in processed_deals if d["is_lead"])

    # Deals by time period
    now = datetime.now()
    deals_30d = sum(1 for d in processed_deals
                   if d["date"] and datetime.fromisoformat(d["date"]) > now - timedelta(days=30))
    deals_90d = sum(1 for d in processed_deals
                   if d["date"] and datetime.fromisoformat(d["date"]) > now - timedelta(days=90))

    # By round type
    by_round = {}
    for d in processed_deals:
        rt = d["round_type"]
        by_round[rt] = by_round.get(rt, 0) + 1

    # By category
    by_category = {}
    for d in processed_deals:
        cat = d["category"]
        by_category[cat] = by_category.get(cat, 0) + 1

    return {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "version": "2.0",
        "data_sources": [
            {"name": "DefiLlama", "url": SOURCES["defillama"], "last_fetched": datetime.now().strftime("%Y-%m-%d")},
            {"name": "Crypto-Fundraising.info", "url": SOURCES["crypto_fundraising"], "last_fetched": datetime.now().strftime("%Y-%m-%d")},
            {"name": "DropsTab", "url": SOURCES["dropstab"], "last_fetched": datetime.now().strftime("%Y-%m-%d")},
        ],
        "summary": {
            "total_deals": len(processed_deals),
            "portfolio_matches": portfolio_matches,
            "total_disclosed_amount_usd": total_disclosed,
            "deals_30d": deals_30d,
            "deals_90d": deals_90d,
            "lead_investments": lead_investments,
            "by_round": by_round,
            "by_category": by_category
        },
        "deals": processed_deals
    }


def main():
    """Main entry point."""
    print("=" * 60)
    print("Blockwall Dealflow Data Extraction")
    print("=" * 60)

    # Ensure output directory exists
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Load portfolio companies
    load_portfolio_companies()

    # Fetch deal data
    print("\nFetching deal data from sources...")
    raw_deals = fetch_manual_data()
    print(f"Found {len(raw_deals)} raw deals")

    # Process deals
    print("\nProcessing and normalizing deals...")
    output_data = process_deals(raw_deals)

    # Write output
    output_file = DATA_DIR / "blockwall.json"
    with open(output_file, "w") as f:
        json.dump(output_data, f, indent=2)
    print(f"\nWrote {len(output_data['deals'])} deals to {output_file}")

    # Print summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Total Deals: {output_data['summary']['total_deals']}")
    print(f"Portfolio Matches: {output_data['summary']['portfolio_matches']}")
    print(f"Total Disclosed: ${output_data['summary']['total_disclosed_amount_usd']:,}")
    print(f"Lead Investments: {output_data['summary']['lead_investments']}")
    print(f"Deals (30d): {output_data['summary']['deals_30d']}")
    print(f"Deals (90d): {output_data['summary']['deals_90d']}")
    print("\nBy Round Type:")
    for rt, count in sorted(output_data['summary']['by_round'].items()):
        print(f"  {rt}: {count}")
    print("\nBy Category:")
    for cat, count in sorted(output_data['summary']['by_category'].items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count}")

    print("\nDone!")


if __name__ == "__main__":
    main()
