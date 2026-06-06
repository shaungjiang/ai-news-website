import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const RAW_INPUT = path.join(DATA_DIR, 'raw-news.json');
const NEWS_OUTPUT = path.join(DATA_DIR, 'news.json');

// ====== Category Keywords ======
const CATEGORY_KEYWORDS = {
  '大模型': ['LLM', 'GPT', 'Claude', 'Gemini', '大模型', '语言模型', 'transformer', 'chatgpt', '大型语言', 'foundation model', 'large language'],
  'AI应用': ['应用', '落地', '产品', '发布', '推出', '上线', 'app', 'product', 'launch', 'release', 'feature', 'rollout', '使用', '体验'],
  '政策监管': ['监管', '政策', '法规', '安全', '伦理', 'regulation', 'policy', 'law', 'ban', 'govern', 'ethics', '安全', '隐私', 'privacy'],
  '学术研究': ['论文', '研究', 'arxiv', 'paper', 'research', 'study', 'neurips', 'icml', 'cvpr', 'acl', 'emnlp', 'conference', '模型架构', '训练方法'],
  '开源工具': ['开源', 'github', 'open source', 'tool', 'framework', 'library', 'sdk', 'api', '发布', 'hugging', '免费', '代码'],
  '商业融资': ['融资', '投资', '估值', 'ipo', '上市', 'funding', 'raise', 'billion', 'million', 'valuation', 'acquis', '收购', 'startup', '创'],
};

function categorizeArticle(title, snippet) {
  const text = `${title} ${snippet}`.toLowerCase();
  const matches = [];

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.filter(kw => text.includes(kw.toLowerCase())).length;
    if (score > 0) matches.push({ category, score });
  }

  matches.sort((a, b) => b.score - a.score);

  if (matches.length === 0) return ['综合'];
  // Return top 1-2 categories
  if (matches.length === 1) return [matches[0].category];
  if (matches[0].score >= 2) return [matches[0].category, matches[1].category];
  return [matches[0].category];
}

// ====== Deduplication ======
function deduplicate(articles) {
  const seenUrls = new Set();
  const seenTitles = new Set();
  const result = [];

  for (const article of articles) {
    // URL dedup
    const normalizedUrl = article.link?.toLowerCase().trim();
    if (seenUrls.has(normalizedUrl)) continue;
    if (normalizedUrl) seenUrls.add(normalizedUrl);

    // Title similarity dedup
    const normalizedTitle = article.title?.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '').slice(0, 50);
    if (normalizedTitle && seenTitles.has(normalizedTitle)) continue;
    if (normalizedTitle) seenTitles.add(normalizedTitle);

    result.push(article);
  }

  return result;
}

// ====== Helpers ======
function writeEmptyNews() {
  const result = {
    generatedAt: new Date().toISOString(),
    stats: { total: 0, shown: 0, chinese: 0, english: 0, today: 0 },
    articles: []
  };
  fs.writeFileSync(NEWS_OUTPUT, JSON.stringify(result, null, 2), 'utf-8');
  console.log('📁 Wrote empty news.json');
}

// ====== Main ======
function main() {
  console.log('🔍 Processing news...\n');

  if (!fs.existsSync(RAW_INPUT)) {
    console.warn('⚠️ No raw data found, creating empty result');
    writeEmptyNews();
    return;
  }

  let rawArticles;
  try {
    rawArticles = JSON.parse(fs.readFileSync(RAW_INPUT, 'utf-8'));
    if (!Array.isArray(rawArticles) || rawArticles.length === 0) {
      console.warn('⚠️ Raw data empty, creating empty result');
      writeEmptyNews();
      return;
    }
  } catch (err) {
    console.error('❌ Failed to parse raw-news.json:', err.message);
    writeEmptyNews();
    return;
  }

  // Deduplicate
  const unique = deduplicate(rawArticles);
  console.log(`📊 Dedup: ${rawArticles.length} → ${unique.length} articles`);

  // Add categories
  const processed = unique.map(article => ({
    ...article,
    tags: categorizeArticle(article.title, article.snippet)
  }));

  // Sort by date (newest first)
  processed.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  // Limit to top 50 articles to keep HTML size reasonable
  const limited = processed.slice(0, 50);

  // Generate summary stats (based on full processed set)
  const zhCount = processed.filter(a => a.lang === 'zh').length;
  const enCount = processed.filter(a => a.lang === 'en').length;
  const today = new Date().toDateString();
  const todayCount = processed.filter(a => new Date(a.pubDate).toDateString() === today).length;

  const result = {
    generatedAt: new Date().toISOString(),
    stats: {
      total: processed.length,
      shown: limited.length,
      chinese: zhCount,
      english: enCount,
      today: todayCount
    },
    articles: limited
  };

  fs.writeFileSync(NEWS_OUTPUT, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`✅ Processed: ${processed.length} articles (${zhCount} zh + ${enCount} en, ${todayCount} today)`);
  console.log(`📁 Saved to: ${NEWS_OUTPUT}`);
}

main();
