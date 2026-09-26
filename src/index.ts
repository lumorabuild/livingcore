// Living Core — Main Worker Entry (Island Era)
// Full SSR frontend + API backend. Kevin & Jenny think through the NVIDIA API
// (OpenAI-compatible, free tier) — see src/core/nvidia.ts for the model
// registry and src/world/models.ts for the four island-era chains.
//
// The old talking-era engine (src/core/{kevin,jenny,loop,coherence,
// thinking_rules,rss,dialogue,ai_dialogue}.ts) is deleted — see CLAUDE.md /
// the island-era spec. Everything that used to run a fixed-turn conversation
// loop here now runs src/world/tick.ts#runTick, which advances a simulated
// world (src/world/sim.ts) one scene or one job at a time.

import { Hono } from 'hono';
import api from './routes/api';
import exportsApp from './routes/exports';
import { createViewRoutes, renderNotFound } from './routes/views';
import { registerAccountRoutes } from './routes/account';
import { registerShopRoutes } from './routes/shop';
import { registerDonationRoutes } from './routes/donations';
import { registerAiRoutes } from './routes/ai';
import { buildRobotsTxt, buildSitemapXml, FAVICON_SVG } from './core/seo';
import { cleanupRateLimits } from './core/ratelimit';
import { CACHE, cacheHeaders, seal } from './cache';
import { ensureIslandSchema, getGoneModels, getLastTurnAt, getRecentTurns, loadWorld } from './world/store';
import { CHAPTER_CHAIN, JENNY_CHAIN, KEVIN_CHAIN, NARRATOR_CHAIN } from './world/models';
import { publicWorld, runTick } from './world/tick';
import { reconcileGifts } from './world/gifts';

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  NVIDIA_API_KEY: string;
  AUTH_SERVICE?: Fetcher;
  COIN?: Fetcher;
  DEV_FAKE_AUTH?: string;
  LIVINGCORE_ENCRYPTION_KEY?: string;
};

type ScheduledController = {
  waitUntil: (promise: Promise<any>) => void;
};

const app = new Hono<{ Bindings: Bindings }>();

/*
  ── DEFAULT-DENY CACHING ──
  Registered FIRST, because Hono only wraps routes that were registered AFTER a
  middleware. Every response that did not state a cache policy leaves here as
  no-store instead of inheriting Cloudflare's two-hour heuristic for an
  un-annotated 200. See src/cache.ts for why that default is the dangerous one.
*/
app.use('*', async (c, next) => {
  await next();
  c.res = seal(c.res);
});

// Health check. A liveness probe answers "right now" or it answers nothing useful.
app.get('/health', async (c) => {
  for (const [k, v] of Object.entries(cacheHeaders(CACHE.NO_STORE))) c.header(k, v);
  try {
    await ensureIslandSchema(c.env.DB);
    const [world, gone, lastTurnAt, errorState] = await Promise.all([
      loadWorld(c.env.DB),
      getGoneModels(c.env.DB),
      getLastTurnAt(c.env.DB),
      c.env.DB.prepare(`SELECT key, value FROM system_state WHERE key IN ('last_error', 'last_fallback')`)
        .all<{ key: string; value: string }>()
        .catch(() => ({ results: [] as { key: string; value: string }[] })),
    ]);

    const byKey: Record<string, string> = {};
    for (const row of errorState.results || []) byKey[row.key] = row.value;

    const minutesSilent = lastTurnAt ? Math.round((Date.now() - Date.parse(lastTurnAt)) / 60000) : null;

    return c.json({
      status: world ? 'alive' : 'not_started',
      era: 'island',
      day: world?.day ?? null,
      slot: world?.slot ?? null,
      last_turn_at: lastTurnAt,
      minutes_silent: minutesSilent,
      last_error: byKey.last_error || null,
      last_fallback: byKey.last_fallback || null,
      gone_models: [...gone],
      chains: {
        kevin: KEVIN_CHAIN.map((m) => m.id),
        jenny: JENNY_CHAIN.map((m) => m.id),
        narrator: NARRATOR_CHAIN.map((m) => m.id),
        chapter: CHAPTER_CHAIN.map((m) => m.id),
      },
    });
  } catch (err) {
    return c.json({ status: 'error', error: String(err) }, 500);
  }
});

// Manual cron trigger (HTTP) — for debugging. The repo is public, so this URL is
// known: allow at most one HTTP-triggered tick per minute so it can't be hammered
// to drain the daily AI budget. (The real schedule calls runTick directly.)
/*
  ⚠️ A GET THAT WRITES. It spends real AI budget and mutates D1, so it must never
  be answered from cache — a stored 200 here would also hide the rate limiter
  three lines down.
*/
app.get('/__cron', async (c) => {
  for (const [k, v] of Object.entries(cacheHeaders(CACHE.NO_STORE))) c.header(k, v);
  const row = await c.env.DB.prepare("SELECT value FROM system_state WHERE key = 'last_manual_cron'")
    .first<{ value: string }>();
  const last = row ? Date.parse(row.value) || 0 : 0;
  if (Date.now() - last < 60_000) {
    return c.json({ success: false, error: 'rate limited — try again in a minute' }, 429);
  }
  const now = new Date();
  await c.env.DB.prepare(
    `INSERT INTO system_state (key, value, updated_at) VALUES ('last_manual_cron', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(now.toISOString(), now.toISOString().replace('T', ' ').slice(0, 19)).run();

  try {
    const result = await runTick({ DB: c.env.DB, NVIDIA_API_KEY: c.env.NVIDIA_API_KEY, LIVINGCORE_ENCRYPTION_KEY: c.env.LIVINGCORE_ENCRYPTION_KEY });
    try {
      c.executionCtx.waitUntil(cleanupRateLimits(c.env.DB, 2 * 60 * 60 * 1000).catch(() => {}));
    } catch {
      await cleanupRateLimits(c.env.DB, 2 * 60 * 60 * 1000).catch(() => {});
    }
    return c.json({ success: true, ...result });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// The live poll — the hot path: public/script.js asks for this every FIVE
// SECONDS. See CACHE.POLL in src/cache.ts for why the edge absorbs most of it.
// Deliberately reads ONLY store.getRecentTurns + store.loadWorld — never the
// old getFullState (which scanned 15k packets + a 152k-row GROUP BY on every
// poll).
app.get('/api/poll', async (c) => {
  for (const [k, v] of Object.entries(cacheHeaders(CACHE.POLL))) c.header(k, v);
  const sinceId = parseInt(c.req.query('since') || '0') || 0;

  const world = await loadWorld(c.env.DB);
  if (!world) {
    return c.json({ latest_turn_id: sinceId, new_turns: [], world: null, status: 'not_started' });
  }

  const turns = await getRecentTurns(c.env.DB, sinceId, 50);
  const latestTurnId = turns.length ? turns[turns.length - 1].id : sinceId;

  return c.json({
    latest_turn_id: latestTurnId,
    new_turns: turns.map((t) => ({
      id: t.id,
      speaker: t.speaker,
      say: t.say,
      // Back-compat: pre-island clients read `content` as the spoken line.
      content: t.say,
      thought: t.thought,
      do: t.action,
      scene_id: t.scene_id,
      created_at: t.created_at,
      model: t.model,
      // Part 2 additions (spec §A): what they were doing, where THEY (the
      // speaker) were — not necessarily the scene's own shared `location`,
      // which is meaningless while apart — and whether this turn's scene was
      // together or apart, so the client can pick a rendering track.
      activity: t.activity,
      location: t.location,
      mode: t.mode,
    })),
    world: publicWorld(world),
    status: 'alive',
  });
});

app.get('/api/world', async (c) => {
  for (const [k, v] of Object.entries(cacheHeaders(CACHE.POLL))) c.header(k, v);
  const world = await loadWorld(c.env.DB);
  if (!world) return c.json({ world: null, events: [], status: 'not_started' });
  const { getRecentEvents } = await import('./world/store');
  const events = await getRecentEvents(c.env.DB, 20);
  return c.json({ world: publicWorld(world), events, status: 'alive' });
});

// ── SEO: robots, sitemap, favicon (must be before the catch-all redirect) ──
app.get('/robots.txt', (c) =>
  c.text(buildRobotsTxt(), 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    ...cacheHeaders(CACHE.SEO),
  })
);

app.get('/sitemap.xml', async (c) => {
  try {
    const xml = await buildSitemapXml(c.env.DB);
    return c.body(xml, 200, {
      'Content-Type': 'application/xml; charset=utf-8',
      ...cacheHeaders(CACHE.SEO),
    });
  } catch (err) {
    return c.text(`sitemap error: ${String(err)}`, 500);
  }
});

app.get('/favicon.svg', (c) =>
  c.body(FAVICON_SVG, 200, {
    'Content-Type': 'image/svg+xml',
    ...cacheHeaders(CACHE.SEO),
  })
);
// Browsers/bots still probe /favicon.ico — serve the same SVG rather than 302→/.
app.get('/favicon.ico', (c) =>
  c.body(FAVICON_SVG, 200, {
    'Content-Type': 'image/svg+xml',
    ...cacheHeaders(CACHE.SEO),
  })
);

// SSR page routes (must be before static asset fallback)
// Patrons (SPEC4): LB sign-in + account, the shop + shrine, lend-a-mind, AI discovery.
// Mounted BEFORE the view routes and the catch-all.
registerAccountRoutes(app);
registerShopRoutes(app);
registerDonationRoutes(app);
registerAiRoutes(app);
createViewRoutes(app);

// Dataset exports — mounted BEFORE the generic /api router so its narrower
// routes win (see src/routes/exports.ts's header for what moved here).
app.route('/api/export', exportsApp);

// API routes
app.route('/api', api);

// Static assets (script.js, app.css) — only for non-HTML routes
app.get('/script.js', async (c) => {
  try {
    return await c.env.ASSETS.fetch(c.req.raw);
  } catch {
    return c.text('// script not found', 404);
  }
});
app.get('/app.css', async (c) => {
  try {
    return await c.env.ASSETS.fetch(c.req.raw);
  } catch {
    return c.text('/* stylesheet not found */', 404);
  }
});

// A real 404. Until 2026-09-25 this was a 302 to "/", which search engines
// read as a soft 404 and which hid broken links (site-verify flagged it).
//
// ⚠️ Deliberately NOT cached: the Workers cache key is path + query, so every
// path a scanner invents would get its own stored entry, and a route added
// later could be shadowed by a 404 stored before it existed.
app.all('*', (c) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return renderNotFound(c);
  return c.text('not found', 404, cacheHeaders(CACHE.NO_STORE));
});

// ── SCHEDULED EVENT HANDLER ──
// NOTE: this MUST be a method on the default export (see bottom of file). A bare
// `export function scheduled` is NOT invoked by the Workers runtime for cron —
// only `default.fetch` / `default.scheduled` are.
async function scheduled(event: ScheduledEvent, env: Bindings, ctx: ScheduledController) {
  const work = runTick({ DB: env.DB, NVIDIA_API_KEY: env.NVIDIA_API_KEY, LIVINGCORE_ENCRYPTION_KEY: env.LIVINGCORE_ENCRYPTION_KEY })
    .finally(() => Promise.all([
      cleanupRateLimits(env.DB, 2 * 60 * 60 * 1000).catch(() => {}),
      // Finishes gift purchases whose payment answer was unclear, and refunds
      // gifts whose item left the catalog (world/gifts.ts#reconcileGifts).
      reconcileGifts(env).catch((err) => console.warn('reconcileGifts failed', String(err))),
    ]));
  // Prefer waitUntil, but also await so the tick reliably completes (local dev's
  // scheduled emulation doesn't always provide a usable waitUntil).
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(work);
  await work;
}

// Cloudflare invokes handlers as methods on the DEFAULT export. We expose Hono's
// fetch AND the cron scheduled handler here so both HTTP and cron actually run.
export default {
  fetch: app.fetch,
  scheduled,
};
