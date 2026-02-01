#!/usr/bin/env python3
"""
Blockwall Insights - Content Feed Updater

Updates substack.json from RSS feed and validates linkedin.json structure.

Usage:
  python update_feeds.py                    # Update all feeds
  python update_feeds.py --substack         # Update Substack only
  python update_feeds.py --validate         # Validate JSON files only

Requirements:
  pip install feedparser requests
"""

import argparse
import json
import os
from datetime import datetime
from pathlib import Path

try:
    import feedparser
    import requests
except ImportError:
    print("Installing required packages...")
    os.system("pip install feedparser requests")
    import feedparser
    import requests

# Paths
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent / "data"

SUBSTACK_RSS = "https://insights.blockwall.vc/feed"
SUBSTACK_JSON = DATA_DIR / "substack.json"
LINKEDIN_JSON = DATA_DIR / "linkedin.json"


def fetch_substack_rss():
    """Fetch and parse Substack RSS feed"""
    print(f"📥 Fetching Substack RSS: {SUBSTACK_RSS}")
    
    try:
        feed = feedparser.parse(SUBSTACK_RSS)
        
        if feed.bozo:
            print(f"  ⚠️  RSS parse warning: {feed.bozo_exception}")
        
        articles = []
        for entry in feed.entries[:6]:  # Get latest 6 articles
            # Extract image from content or use fallback
            image = "https://images.unsplash.com/photo-1639762681057-408e52192e55?w=600&h=300&fit=crop"
            
            if hasattr(entry, 'media_content') and entry.media_content:
                image = entry.media_content[0].get('url', image)
            elif hasattr(entry, 'content') and entry.content:
                # Try to extract first image from content
                content = entry.content[0].get('value', '')
                import re
                img_match = re.search(r'<img[^>]+src="([^"]+)"', content)
                if img_match:
                    image = img_match.group(1)
            
            # Parse date
            published = entry.get('published', entry.get('updated', ''))
            try:
                date_obj = datetime(*entry.published_parsed[:6])
                date_str = date_obj.strftime('%Y-%m-%d')
            except:
                date_str = datetime.now().strftime('%Y-%m-%d')
            
            # Extract excerpt
            excerpt = ""
            if hasattr(entry, 'summary'):
                # Strip HTML tags
                import re
                excerpt = re.sub(r'<[^>]+>', '', entry.summary)
                excerpt = excerpt[:200].strip()
                if len(entry.summary) > 200:
                    excerpt += "..."
            
            articles.append({
                "title": entry.title,
                "url": entry.link,
                "author": entry.get('author', 'Blockwall Team'),
                "date": date_str,
                "excerpt": excerpt,
                "image": image
            })
        
        return articles
    
    except Exception as e:
        print(f"  ❌ Error fetching RSS: {e}")
        return None


def update_substack():
    """Update substack.json from RSS feed"""
    articles = fetch_substack_rss()
    
    if articles:
        with open(SUBSTACK_JSON, 'w', encoding='utf-8') as f:
            json.dump(articles, f, indent=2, ensure_ascii=False)
        print(f"  ✅ Updated {SUBSTACK_JSON} with {len(articles)} articles")
    else:
        print("  ℹ️  Using existing substack.json (RSS fetch failed)")


def validate_json_files():
    """Validate JSON structure of data files"""
    print("\n🔍 Validating JSON files...")
    
    files_to_check = [
        (SUBSTACK_JSON, ['title', 'url', 'author', 'date', 'excerpt']),
        (LINKEDIN_JSON, ['type', 'author', 'content', 'url', 'date']),
        (DATA_DIR / "daily.json", ['date', 'title', 'filename', 'sources']),
        (DATA_DIR / "weekly.json", ['week', 'title', 'filename', 'stories']),
        (DATA_DIR / "monthly.json", ['month', 'title', 'filename', 'stories']),
    ]
    
    all_valid = True
    
    for filepath, required_fields in files_to_check:
        if not filepath.exists():
            print(f"  ⚠️  {filepath.name}: File not found")
            continue
        
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            if not isinstance(data, list):
                print(f"  ❌ {filepath.name}: Expected array, got {type(data).__name__}")
                all_valid = False
                continue
            
            # Check first item for required fields
            if data:
                missing = [f for f in required_fields if f not in data[0]]
                if missing:
                    print(f"  ⚠️  {filepath.name}: Missing fields: {missing}")
                else:
                    print(f"  ✅ {filepath.name}: Valid ({len(data)} items)")
            else:
                print(f"  ℹ️  {filepath.name}: Empty array")
        
        except json.JSONDecodeError as e:
            print(f"  ❌ {filepath.name}: Invalid JSON - {e}")
            all_valid = False
    
    return all_valid


def main():
    parser = argparse.ArgumentParser(description='Blockwall Content Feed Updater')
    parser.add_argument('--substack', action='store_true', help='Update Substack feed only')
    parser.add_argument('--validate', action='store_true', help='Validate JSON files only')
    args = parser.parse_args()
    
    if args.validate:
        validate_json_files()
        return
    
    if args.substack or not any([args.substack]):
        update_substack()
    
    validate_json_files()
    
    print("\n✨ Feed update complete!")
    print("\nNote: LinkedIn feed requires manual curation.")
    print("Edit data/linkedin.json to add Dominic's posts/reposts.")


if __name__ == '__main__':
    main()
