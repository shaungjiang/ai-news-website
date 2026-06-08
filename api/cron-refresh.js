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
    const u = article.link?.toLowerCase().trim();
    if (u && seenUrls.has(u)) continue;
    if (u) seenUrls.add(u);
    const t = article.title?.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '').slice(0, 50);
    if (t && seenTitles.has(t)) continue;
    if (t) seenTitles.add(t);
    result.push(article);
  }
  return result;
}

export default async function handler(req, res) {
  console.log('⏰ Cron refresh started');

  // Only allow cron or authorized requests
  const auth = req.headers.authorization;
  const expected = process.env.CRON_SECRET;
  if (expected && (!auth || auth !== `Bearer ${expected}`)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const sourcesPath = path.join(process.cwd(), 'data', 'sources.json');
  let sources;
  try {
    sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf-8'));
  } catch {
    return res.status(500).json({ error: 'sources.json not found' });
  }

  const parser = new Parser({
    timeout: 6000,
    headers: {
      'User-Agent': 'AI-News-Aggregator/1.0 (RSS Reader Bot)',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*'
    }
  });

  const startTime = Date.now();
  const results = await Promise.all(sources.map(async (source) => {
    try {
      const feed = await parser.parseURL(source.url);
      const items = (feed.items || [])
        .filter(item => {
          const d = new Date(item.pubDate || item.isoDate || Date.now());
          const cutoff = Date.now() - 7 * 86400000;
          return !isNaN(d.getTime()) && d.getTime() > cutoff;
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
      console.log(`  ✅ ${source.id}: ${items.length} articles`);
      return items;
    } catch (err) {
      console.log(`  ❌ ${source.id}: ${err.message.slice(0, 60)}`);
      return [];
    }
  }));

  const allArticles = results.flat();
  console.log(`  Fetched: ${allArticles.length} total`);

  if (allArticles.length === 0) {
    return res.status(200).json({ ok: false, reason: 'no articles fetched' });
  }

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

  // Write to /tmp so api/news.js can read it (shared within deployment)
  try {
    fs.writeFileSync('/tmp/news.json', JSON.stringify(result, null, 2), 'utf-8');
    console.log(`  💾 Saved to /tmp/news.json (${limited.length} shown, ${zhCount}zh + ${enCount}en, ${todayCount} today)`);
  } catch (err) {
    console.log(`  ⚠️ Write failed: ${err.message}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  ⏱️ Done in ${elapsed}s`);

  return res.status(200).json({
    ok: true,
    count: limited.length,
    elapsed: `${elapsed}s`,
    generatedAt: result.generatedAt
  });
}
