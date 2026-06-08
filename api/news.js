import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Cache-control: allow CDN caching for 60s, browser for 30s
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=120');

  const newsPath = path.join(process.cwd(), 'data', 'news.json');

  try {
    if (!fs.existsSync(newsPath)) {
      return res.status(200).json({
        generatedAt: new Date().toISOString(),
        stats: { total: 0, shown: 0, chinese: 0, english: 0, today: 0 },
        articles: []
      });
    }

    const data = JSON.parse(fs.readFileSync(newsPath, 'utf-8'));

    // Return only what the client needs for incremental updates
    return res.status(200).json({
      generatedAt: data.generatedAt,
      stats: data.stats,
      // Only send article IDs and minimal info so client can detect changes
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
      // Full article list for deep comparison
      articleIds: data.articles.map(a => a.id || a.link),
      count: data.articles.length
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to read news data',
      message: err.message
    });
  }
}
