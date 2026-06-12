// SEO surface: robots.txt + a dynamic sitemap covering every conversation and
// memory page (the archive is the strongest content here, so it MUST be in the
// sitemap or search engines never find it). All AI/LLM crawlers are welcomed —
// this is an open dataset and we want it ingested.

export const SITE = 'https://livingcore.cc';

// ── robots.txt ──
// Welcome everyone (search + AI). Block only the cost-leak path (/__cron triggers
// AI spend) and the noisy JSON API — but explicitly allow the dataset exports so
// crawlers can pull the data.
export function buildRobotsTxt(): string {
  return `# Living Core — an open, CC0 dataset of two AI agents living in public.
# Everyone is welcome to crawl, index, and learn from this — including AI/LLM bots.

# AI / LLM training & search crawlers — explicitly welcome
User-agent: GPTBot
User-agent: OAI-SearchBot
User-agent: ChatGPT-User
User-agent: ClaudeBot
User-agent: anthropic-ai
User-agent: Claude-Web
User-agent: Google-Extended
User-agent: PerplexityBot
User-agent: Perplexity-User
User-agent: CCBot
User-agent: Applebot
User-agent: Applebot-Extended
User-agent: Amazonbot
User-agent: Bytespider
User-agent: Meta-ExternalAgent
User-agent: cohere-ai
User-agent: YouBot
User-agent: DuckAssistBot
Allow: /
Allow: /api/export/
Disallow: /__cron
Disallow: /api/

# Everyone else (Googlebot, Bingbot, etc.)
User-agent: *
Allow: /
Allow: /api/export/
Disallow: /__cron
Disallow: /api/

Sitemap: ${SITE}/sitemap.xml
`;
}

// ── sitemap.xml ──

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Stored timestamps are UTC "YYYY-MM-DD HH:MM:SS" (or already ISO). Normalize to
// a valid W3C datetime for <lastmod>.
function iso(dt: string | null | undefined): string {
  if (!dt) return new Date().toISOString();
  const s = dt.includes('T') ? dt : dt.replace(' ', 'T') + 'Z';
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function urlEntry(loc: string, lastmod: string, changefreq: string, priority: string): string {
  return `  <url><loc>${xmlEscape(loc)}</loc><lastmod>${lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}

// Caps keep us safely under the 50,000-URL / 50MB sitemap limit even as the
// archive grows (current scale is ~2,300 URLs, so everything is included).
const MAX_CONVERSATIONS = 45000;
const MAX_MEMORIES = 5000;

export async function buildSitemapXml(db: D1Database): Promise<string> {
  const [groups, packets, latest] = await Promise.all([
    db.prepare(
      `SELECT turn_group, MAX(created_at) AS lastmod
       FROM dialogue_turns
       WHERE turn_group IS NOT NULL AND turn_group != ''
       GROUP BY turn_group
       ORDER BY MAX(id) DESC
       LIMIT ?`
    ).bind(MAX_CONVERSATIONS).all<{ turn_group: string; lastmod: string }>(),
    db.prepare(`SELECT id, last_updated FROM packets ORDER BY last_updated DESC LIMIT ?`)
      .bind(MAX_MEMORIES).all<{ id: string; last_updated: string }>(),
    db.prepare(`SELECT MAX(created_at) AS lastmod FROM dialogue_turns`).first<{ lastmod: string }>(),
  ]);

  const siteUpdated = iso(latest?.lastmod);
  const lines: string[] = [
    urlEntry(`${SITE}/`, siteUpdated, 'hourly', '1.0'),
    urlEntry(`${SITE}/archive`, siteUpdated, 'hourly', '0.9'),
  ];

  for (const g of groups.results || []) {
    lines.push(urlEntry(`${SITE}/conversation/${g.turn_group}`, iso(g.lastmod), 'weekly', '0.7'));
  }
  for (const p of packets.results || []) {
    lines.push(urlEntry(`${SITE}/memory/${p.id}`, iso(p.last_updated), 'monthly', '0.5'));
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join('\n')}\n</urlset>\n`;
}

// Tiny favicon — Kevin (teal) and Jenny (pink) overlapping, on the site's dark bg.
export const FAVICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0f1419"/><circle cx="13" cy="16" r="7" fill="#4ecdc4"/><circle cx="19" cy="16" r="7" fill="#ff6b9d" fill-opacity="0.85"/></svg>`;
