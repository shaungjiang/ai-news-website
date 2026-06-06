import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Parser from 'rss-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const SOURCES_FILE = path.join(DATA_DIR, 'sources.json');
const RAW_OUTPUT = path.join(DATA_DIR, 'raw-news.json');

const parser = new Parser({
  timeout: 8000,  // 8s per source (reduced from 15s)
  headers: {
    'User-Agent': 'AI-News-Aggregator/1.0 (RSS Reader Bot)',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*'
  }
});

async function fetchSource(source) {
  console.log(`  📡 Fetching ${source.name}...`);
  try {
    const feed = await parser.parseURL(source.url);
    const items = (feed.items || [])
      .map(item => ({
        id: generateId(source.id, item.link || item.guid || ''),
        title: item.title?.trim() || '',
        link: item.link || '',
        snippet: (item.contentSnippet || item.content || '').slice(0, 150).replace(/\n/g, ' ').trim(),
        pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
        sourceName: source.name,
        sourceId: source.id,
        lang: source.lang,
        category: source.category,
        creator: item.creator || '',
        fetchedAt: new Date().toISOString()
      }))
      .filter(item => {
        // Only keep articles from last 7 days
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const itemDate = new Date(item.pubDate).getTime();
        return !isNaN(itemDate) && itemDate > sevenDaysAgo;
      })
      .slice(0, 30); // Max 30 per source
    console.log(`     ✅ Got ${items.length} articles`);
    return items;
  } catch (err) {
    console.log(`     ❌ Failed: ${err.message.slice(0, 80)}`);
    return [];
  }
}

function generateId(sourceId, link) {
  const hash = Buffer.from(`${sourceId}:${link}`).toString('base64').slice(0, 16);
  return hash;
}

async function main() {
  console.log('🚀 AI News Fetcher - Starting...\n');

  if (!fs.existsSync(SOURCES_FILE)) {
    console.error('❌ sources.json not found!');
    process.exit(1);
  }

  const sources = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf-8'));
  console.log(`📋 Loaded ${sources.length} sources\n`);

  const allItems = [];
  for (const source of sources) {
    const items = await fetchSource(source);
    allItems.push(...items);
    // Small delay between requests to be polite
    await new Promise(r => setTimeout(r, 200));
  }

  // Always save results (even empty)
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(RAW_OUTPUT, JSON.stringify(allItems, null, 2), 'utf-8');

  console.log(`\n✅ Done! Total fetched: ${allItems.length} articles`);
  console.log(`📁 Saved to: ${RAW_OUTPUT}`);
}

main().catch(err => {
  console.error('❌ Fatal fetch error:', err.message);
  // Write empty array so downstream steps don't crash
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(RAW_OUTPUT, '[]', 'utf-8');
    console.log('📁 Wrote empty fallback raw-news.json');
  } catch (e) {
    console.error('Could not write fallback:', e.message);
  }
  process.exit(0); // Don't fail the workflow
});
