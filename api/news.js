import fs from 'fs';
import path from 'path';
import Parser from 'rss-parser';

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
  if (matches.length === 1) return [matches[0].category];
  if (matches[0].score >= 2) return [matches[0].category, matches[1].category];
  return [matches[0].category];
}

function deduplicate(articles) {
  const seenUrls = new Set();
  const seenTitles = new Set();
  const result = [];
  for (const article of articles) {
    const normalizedUrl = article.link?.toLowerCase().trim();
    if (normalizedUrl && seenUrls.has(normalizedUrl)) continue;
    if (normalizedUrl) seenUrls.add(normalizedUrl);
    const normalizedTitle = article.title?.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '').slice(0, 50);
    if (normalizedTitle && seenTitles.has(normalizedTitle)) continue;
    if (normalizedTitle) seenTitles.add(normalizedTitle);
    result.push(article);
  }
  return result;
}

// ====== Live Fetch (self-refreshing when data is stale) ======
async function liveFetchArticles() {
  const sourcesPath = path.join(process.cwd(), 'data', 'sources.json');
  let sources;
  try {
    sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf-8'));
  } catch {
    return null;
  }

  const parser = new Parser({
    timeout: 5000,
    headers: {
      'User-Agent': 'AI-News-Aggregator/1.0 (RSS Reader Bot)',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*'
    }
  });

  // Fetch all sources in parallel
  const results = await Promise.all(sources.map(async (source) => {
    try {
      const feed = await parser.parseURL(source.url);
      return (feed.items || [])
        .filter(item => {
          const date = new Date(item.pubDate || item.isoDate || Date.now());
          const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
          return !isNaN(date.getTime()) && date.getTime() > sevenDaysAgo;
        })
        .slice(0, 20)
        .map(item => ({
          id: Buffer.from(`${source.id}:${item.link || item.guid || ''}`).toString('base64').slice(0, 16),
          title: (item.title || '').trim(),
          link: item.link || '',
          snippet: (item.contentSnippet || item.content || '').slice(0, 150).replace(/\n/g, ' ').trim(),
          pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
          sourceName: source.name,
          sourceId: source.id,
          lang: source.lang
        }));
    } catch {
      return [];
    }
  }));

  const allArticles = results.flat();
  if (allArticles.length === 0) return null;

  // Process
  const unique = deduplicate(allArticles);
  const processed = unique.map(a => ({ ...a, tags: categorizeArticle(a.title, a.snippet) }));
  processed.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  const limited = processed.slice(0, 50);

  const zhCount = processed.filter(a => a.lang === 'zh').length;
  const enCount = processed.filter(a => a.lang === 'en').length;
  const today = new Date().toDateString();
  const todayCount = processed.filter(a => new Date(a.pubDate).toDateString() === today).length;

  const result = {
    generatedAt: new Date().toISOString(),
    stats: { total: processed.length, shown: limited.length, chinese: zhCount, english: enCount, today: todayCount },
    articles: limited
  };

  // Save to disk so subsequent requests hit cache
  try {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'news.json'), JSON.stringify(result, null, 2), 'utf-8');
  } catch {}

  return result;
}

function readCachedNews() {
  const newsPath = path.join(process.cwd(), 'data', 'news.json');
  if (!fs.existsSync(newsPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(newsPath, 'utf-8'));
    const ageMs = Date.now() - new Date(data.generatedAt).getTime();
    return { data, ageMs };
  } catch {
    return null;
  }
}

// ====== Handler ======
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const STALE_THRESHOLD = 2 * 60 * 60 * 1000; // 2 hours
  const cached = readCachedNews();

  // If data is fresh, return immediately
  if (cached && cached.data && cached.ageMs < STALE_THRESHOLD) {
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json(formatResponse(cached.data));
  }

  // Data is stale or missing — try to refresh
  console.log('Data stale (' + (cached ? Math.round(cached.ageMs / 60000) + 'min' : 'missing') + '), fetching live...');
  const fresh = await liveFetchArticles();

  if (fresh) {
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json(formatResponse(fresh));
  }

  // Live fetch failed, return stale data if available
  if (cached && cached.data) {
    console.log('Live fetch failed, returning stale data');
    res.setHeader('X-Data-Stale', 'true');
    res.setHeader('Cache-Control', 'public, max-age=15, s-maxage=30');
    return res.status(200).json(formatResponse(cached.data));
  }

  // Nothing available
  return res.status(200).json({
    generatedAt: new Date().toISOString(),
    stats: { total: 0, shown: 0, chinese: 0, english: 0, today: 0 },
    articles: [],
    articleIds: [],
    digest: [],
    count: 0
  });
}

function formatResponse(data) {
  return {
    generatedAt: data.generatedAt,
    stats: data.stats,
    digest: data.articles.slice(0, 10).map(a => ({
      id: a.id || a.link,
      title: a.title,
      pubDate: a.pubDate,
      lang: a.lang,
      sourceId: a.sourceId,
      sourceName: a.sourceName,
      link: a.link,
      snippet: a.snippet,
      tags: a.tags,
    })),
    articleIds: data.articles.map(a => a.id || a.link),
    count: data.articles.length
  };
}
