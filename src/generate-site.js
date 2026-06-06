import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const PUBLIC_DIR = path.join(ROOT, 'public');

// ====== Handlebars helpers ======
Handlebars.registerHelper('formatDate', (dateStr) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  const diffD = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffH < 1) return '刚刚';
  if (diffH < 24) return `${diffH} 小时前`;
  if (diffD < 2) return '昨天';
  if (diffD < 7) return `${diffD} 天前`;
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
});

Handlebars.registerHelper('formatFullDate', (dateStr) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
});

Handlebars.registerHelper('eq', (a, b) => a === b);

Handlebars.registerHelper('json', (obj) => JSON.stringify(obj));

// Source-specific colors for the dot indicator
Handlebars.registerHelper('sourceColor', (sourceId) => {
  const colors = {
    'qbitai': '#e65100',
    '36kr-ai': '#1976d2',
    'leiphone': '#c62828',
    'itjuzi-ai': '#6d28d9',
    'techcrunch-ai': '#0a9e4a',
    'theverge-ai': '#7b2ff0',
    'mit-tr': '#b91c1c',
    'venturebeat-ai': '#2e7d32',
    'arstechnica-ai': '#e65100',
    'openai-blog': '#10a37f',
    'huggingface-blog': '#f5a623',
    'marktechpost': '#3b6df0',
  };
  return colors[sourceId] || '#8e8ea8';
});

// Tag CSS class mapping
Handlebars.registerHelper('tagClass', (tag) => {
  const map = {
    '大模型': 'model',
    'AI应用': 'app',
    '政策监管': 'policy',
    '学术研究': 'research',
    '开源工具': 'opensrc',
    '商业融资': 'biz',
    '综合': 'general',
  };
  return map[tag] || 'general';
});

// ====== Group articles by date ======
function groupByDate(articles) {
  const groups = {};
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  for (const article of articles) {
    const date = new Date(article.pubDate).toDateString();
    let label;
    if (date === today) label = '今日';
    else if (date === yesterday) label = '昨天';
    else label = new Date(article.pubDate).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });

    if (!groups[label]) groups[label] = [];
    groups[label].push(article);
  }

  return Object.entries(groups).map(([label, items]) => ({ label, items }));
}

// ====== Render ======
function main() {
  console.log('🎨 Generating website...\n');

  const newsPath = path.join(DATA_DIR, 'news.json');
  let data;
  if (!fs.existsSync(newsPath)) {
    console.warn('⚠️ news.json not found, using empty data');
    data = { generatedAt: new Date().toISOString(), stats: { total: 0, shown: 0, chinese: 0, english: 0, today: 0 }, articles: [] };
  } else {
    try {
      data = JSON.parse(fs.readFileSync(newsPath, 'utf-8'));
    } catch (err) {
      console.warn('⚠️ news.json parse error, using empty data');
      data = { generatedAt: new Date().toISOString(), stats: { total: 0, shown: 0, chinese: 0, english: 0, today: 0 }, articles: [] };
    }
  }
  const dateGroups = groupByDate(data.articles);

  // Build template context
  const context = {
    generatedAt: new Date(data.generatedAt).toLocaleString('zh-CN'),
    stats: data.stats,
    dateGroups,
    nowDate: new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }),
  };

  // Compile template
  const templateSource = fs.readFileSync(path.join(TEMPLATES_DIR, 'index.hbs'), 'utf-8');
  const template = Handlebars.compile(templateSource);
  const html = template(context);

  // Write output
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.writeFileSync(path.join(PUBLIC_DIR, 'index.html'), html, 'utf-8');

  console.log(`✅ Generated: ${html.length.toLocaleString()} bytes`);
  console.log(`📁 Output: ${path.join(PUBLIC_DIR, 'index.html')}`);
}

main();
