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
Disallow: /auth/

# Everyone else (Googlebot, Bingbot, etc.)
User-agent: *
Allow: /
Allow: /api/export/
Disallow: /__cron
Disallow: /api/
Disallow: /auth/

# Plain-text brief for language models: ${SITE}/llms.txt
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
// Island era caps — small and bounded; these tables grow by at most a
// handful of rows a day, so these ceilings are years of headroom.
const MAX_DAYS = 3000;
const MAX_SCENES = 20000;
const MAX_ARTIFACTS = 10000;

export async function buildSitemapXml(db: D1Database): Promise<string> {
  const [groups, packets, latest, chapters, closedScenes, artifacts] = await Promise.all([
    db.prepare(
      `SELECT turn_group, MAX(created_at) AS lastmod
       FROM dialogue_turns
       WHERE turn_group IS NOT NULL AND turn_group != ''
       GROUP BY turn_group
       ORDER BY MAX(id) DESC
       LIMIT ?`
    ).bind(MAX_CONVERSATIONS).all<{ turn_group: string; lastmod: string }>(),
    /*
      ⚠️ ONE URL PER DISTINCT TEXT, NOT ONE PER ROW.

      Measured on production 2026-09-07: the packets table holds 12,681 rows
      carrying **228 distinct texts**. The plain `LIMIT 5000` this used to be
      therefore advertised five thousand URLs that between them said 92 different
      things — pages byte-identical apart from a timestamp, each one
      self-canonicalising, each one asking Google to index it.

      That is the single strongest spam signal a site can send: an unbounded
      generator of near-identical indexable URLs, with a fresh `lastmod` on every
      one telling Google the site updates hourly. It is worse than it looks right
      now, because the dialogue engine has produced nothing since
      2026-08-26 (its NVIDIA model chain returns 410 — see the note in
      core/nvidia.ts), so duplicates are currently 100% of what this site
      publishes.

      GROUP BY the normalised content and keep the OLDEST row of each group: the
      oldest is the one most likely already indexed and linked, so this shrinks
      the advertised set without inviting Google to re-crawl a new address for
      text it already has.

      ⚠️ This narrows the SITEMAP only. The duplicate /memory/<id> URLs still
      resolve — nothing that is already linked or indexed breaks. Collapsing the
      URL space itself (301 the duplicates to their survivor, and stop minting
      new ones in core/rss.ts) is the real repair and is a separate change.
    */
    db.prepare(
      `SELECT id, last_updated FROM (
         SELECT id, last_updated, created_at,
                ROW_NUMBER() OVER (PARTITION BY TRIM(LOWER(content)) ORDER BY created_at ASC, id ASC) AS rn
           FROM packets
       ) WHERE rn = 1
       ORDER BY last_updated DESC
       LIMIT ?`
    ).bind(MAX_MEMORIES).all<{ id: string; last_updated: string }>(),
    db.prepare(`SELECT MAX(created_at) AS lastmod FROM dialogue_turns`).first<{ lastmod: string }>(),
    // Island era — self-healing tables, so guard with .catch() in case a
    // fresh deploy is asked for the sitemap before ensureIslandSchema has run.
    db.prepare(`SELECT day, created_at FROM chapters ORDER BY day DESC LIMIT ?`).bind(MAX_DAYS)
      .all<{ day: number; created_at: string }>()
      .catch(() => ({ results: [] as { day: number; created_at: string }[] })),
    db.prepare(`SELECT id, closed_at, opened_at FROM scenes WHERE status = 'closed' ORDER BY rowid DESC LIMIT ?`).bind(MAX_SCENES)
      .all<{ id: string; closed_at: string | null; opened_at: string }>()
      .catch(() => ({ results: [] as { id: string; closed_at: string | null; opened_at: string }[] })),
    db.prepare(`SELECT id, created_at FROM artifacts ORDER BY id DESC LIMIT ?`).bind(MAX_ARTIFACTS)
      .all<{ id: number; created_at: string }>()
      .catch(() => ({ results: [] as { id: number; created_at: string }[] })),
  ]);

  const siteUpdated = iso(latest?.lastmod);
  const lines: string[] = [
    urlEntry(`${SITE}/`, siteUpdated, 'hourly', '1.0'),
    urlEntry(`${SITE}/archive`, siteUpdated, 'hourly', '0.9'),
    urlEntry(`${SITE}/days`, siteUpdated, 'daily', '0.9'),
    urlEntry(`${SITE}/workshop`, siteUpdated, 'daily', '0.7'),
    urlEntry(`${SITE}/notebook`, siteUpdated, 'daily', '0.7'),
    urlEntry(`${SITE}/lab`, siteUpdated, 'daily', '0.6'),
    urlEntry(`${SITE}/about`, siteUpdated, 'monthly', '0.4'),
    // Patrons (spec §A2/§A4): both are public, indexable pages (neither sets
    // `noindex` in BaseLayout — see ShopPage.tsx / ShrinePage.tsx). /account
    // deliberately never appears here: it renders a signed-in viewer's own
    // state and is `noindex` (AccountPage.tsx).
    urlEntry(`${SITE}/shop`, siteUpdated, 'weekly', '0.5'),
    urlEntry(`${SITE}/shrine`, siteUpdated, 'daily', '0.5'),
  ];

  for (const g of groups.results || []) {
    lines.push(urlEntry(`${SITE}/conversation/${g.turn_group}`, iso(g.lastmod), 'weekly', '0.7'));
  }
  for (const p of packets.results || []) {
    lines.push(urlEntry(`${SITE}/memory/${p.id}`, iso(p.last_updated), 'monthly', '0.5'));
  }
  for (const ch of (chapters.results || []) as { day: number; created_at: string }[]) {
    lines.push(urlEntry(`${SITE}/day/${ch.day}`, iso(ch.created_at), 'weekly', '0.6'));
  }
  for (const s of (closedScenes.results || []) as { id: string; closed_at: string | null; opened_at: string }[]) {
    lines.push(urlEntry(`${SITE}/scene/${s.id}`, iso(s.closed_at || s.opened_at), 'monthly', '0.4'));
  }
  for (const a of (artifacts.results || []) as { id: number; created_at: string }[]) {
    lines.push(urlEntry(`${SITE}/made/${a.id}`, iso(a.created_at), 'monthly', '0.4'));
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join('\n')}\n</urlset>\n`;
}

// Tiny favicon — Kevin (teal) and Jenny (pink) overlapping, on the site's dark bg.
export const FAVICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0f1419"/><circle cx="13" cy="16" r="7" fill="#4ecdc4"/><circle cx="19" cy="16" r="7" fill="#ff6b9d" fill-opacity="0.85"/></svg>`;
