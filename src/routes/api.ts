// REST API Routes for Living Core.
// NOTE: this repo is PUBLIC and these routes are unauthenticated. Only read
// endpoints and the intended visitor channel (inbox) belong here — anything
// destructive or budget-burning must not be exposed.
//
// ⚠️ Island era (see CLAUDE.md / the spec): the old talking-era engine
// (src/core/dialogue.ts, ai_dialogue.ts, coherence.ts, thinking_rules.ts) is
// deleted. POST /api/inbox no longer calls a model at all — it only stores
// the note; the cron (src/world/tick.ts) is what washes a bottle ashore,
// inside the normal per-tick budget. /api/stats no longer computes coherence
// (that scoring belonged to the deleted packet-coherence engine). The three
// /export/* routes moved to src/routes/exports.ts, mounted at /api/export.
import { Hono } from 'hono';
import { CACHE, cacheHeaders } from '../cache';
import { cors } from 'hono/cors';
import * as packetOps from '../db/packet';
import * as rssOps from '../db/rss';
import * as dialogueOps from '../db/dialogue';
import { getAllCategories } from '../core/categories';

type Bindings = { DB: D1Database; NVIDIA_API_KEY: string };

const api = new Hono<{ Bindings: Bindings }>();

api.use('/*', cors());

/*
  ⚠️ EVERY READ HERE IS EDGE-CACHED UNLESS IT SAYS OTHERWISE.

  These are the pre-island JSON routes: public, unauthenticated, and
  (measured by the pre-ship review, 2026-09-25) until now answered with
  no-store by the global seal(), so every hit re-ran its query — /api/state
  scanned all ~15k packets plus a GROUP BY over ~152k rss_items per request.
  A 5-minute edge copy turns a loop of requests into one query per colo per
  path; the heavy ones below were also cut down to bounded queries.
  POST /inbox and anything that sets its own Cache-Control are untouched.
*/
api.use('/*', async (c, next) => {
  await next();
  if (c.req.method === 'GET' && c.res.status === 200 && !c.res.headers.has('Cache-Control')) {
    for (const [k, v] of Object.entries(cacheHeaders(CACHE.DERIVED_JSON))) c.res.headers.set(k, v);
  }
});

/** A caller-supplied limit, clamped: `?limit=1000000` must not become a full-table read. */
function lim(raw: string | undefined, def: number, max: number): number {
  const n = parseInt(raw || '', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def;
}

/** Row counts by cheap aggregate queries instead of loading every row into the isolate. */
async function legacyCounts(db: D1Database) {
  const row = await db.prepare(
    `SELECT (SELECT COUNT(*) FROM packets) AS packets,
            (SELECT COUNT(*) FROM connections) AS connections,
            (SELECT COUNT(*) FROM packets WHERE type = 'concept') AS concepts`
  ).first<{ packets: number; connections: number; concepts: number }>();
  return { packets: row?.packets || 0, connections: row?.connections || 0, concepts: row?.concepts || 0 };
}

// ── State ──

api.get('/state', async (c) => {
  // The packets/connections arrays this used to embed are gone (the legacy
  // packet engine is retired; /api/packets still pages through them). Counts
  // and the system_state map keep their names.
  const [systemState, counts, dialogueCount, pendingInbox] = await Promise.all([
    packetOps.getSystemState(c.env.DB),
    legacyCounts(c.env.DB),
    dialogueOps.getDialogueTurnCount(c.env.DB),
    dialogueOps.getPendingInboxCount(c.env.DB)
  ]);
  const state = { system_state: systemState, packet_count: counts.packets, connection_count: counts.connections };

  // Rule system data — read-only, unrelated to the deleted dialogue engine.
  const { getActiveRules, getPendingProposals, getRecentAdoptions } = await import('../db/rules');
  const [activeRules, pendingProposals, recentAdoptions] = await Promise.all([
    getActiveRules(c.env.DB).catch(() => []),
    getPendingProposals(c.env.DB).catch(() => []),
    getRecentAdoptions(c.env.DB, 5).catch(() => [])
  ]);

  return c.json({
    success: true,
    data: {
      ...state,
      dialogue_turns: dialogueCount,
      pending_inbox: pendingInbox,
      active_rules: activeRules,
      pending_proposals: pendingProposals,
      recent_adoptions: recentAdoptions
    }
  });
});

// ── Packets ──

api.get('/packets', async (c) => {
  const type = c.req.query('type');
  const search = c.req.query('search');
  let packets;
  const limit = lim(c.req.query('limit'), 100, 200);
  const offset = lim(c.req.query('offset'), 0, 1_000_000);
  if (search) {
    packets = await packetOps.searchPackets(c.env.DB, search.slice(0, 80));
  } else {
    const rows = await c.env.DB.prepare(
      type
        ? 'SELECT * FROM packets WHERE type = ? ORDER BY strength DESC, last_updated DESC LIMIT ? OFFSET ?'
        : 'SELECT * FROM packets ORDER BY strength DESC, last_updated DESC LIMIT ? OFFSET ?'
    ).bind(...(type ? [type, limit, offset] : [limit, offset])).all<any>();
    packets = rows.results || [];
  }
  return c.json({ success: true, data: packets, limit, offset });
});

api.get('/packets/:id', async (c) => {
  const id = c.req.param('id');
  const packet = await packetOps.getPacket(c.env.DB, id);
  if (!packet) return c.json({ success: false, error: 'Packet not found' }, 404);
  const connections = await packetOps.getConnectionsForPacket(c.env.DB, id);
  const connectedIds = new Set<string>();
  for (const conn of connections) {
    connectedIds.add(conn.source_id === id ? conn.target_id : conn.source_id);
  }
  const connectedPackets: any[] = [];
  for (const cid of connectedIds) {
    const cp = await packetOps.getPacket(c.env.DB, cid);
    if (cp) connectedPackets.push(cp);
  }
  return c.json({ success: true, data: { packet, connections, connectedPackets } });
});

// ── Idea Inbox — a visitor's "message in a bottle" ──
// Island era: this endpoint stores the note ONLY. It is deliberately the one
// unauthenticated write route left in the app (besides the rate-limited
// /__cron), so it must never call a model — see CLAUDE.md's "public repo,
// unauthenticated routes" rule and the spec's Bottles section. The cron
// (src/world/tick.ts, via src/world/store.ts#nextBottleAtSea) picks it up and
// washes it ashore inside a scene, on its own schedule and budget.

api.post('/inbox', async (c) => {
  try {
    const body = await c.req.json<{ content: string; author?: string }>();
    if (!body.content || body.content.trim().length === 0) {
      return c.json({ success: false, error: 'Content is required' }, 400);
    }
    // Cap note length — a note is a note, not a prompt to smuggle work through.
    if (body.content.trim().length > 600) {
      return c.json({ success: false, error: 'Note is too long (max 600 characters)' }, 400);
    }

    // Rate limit: even a store-only write, this is the one public write route
    // left, so it must not be scriptable into unbounded spam. Per-IP first,
    // then a global backstop.
    const { rateLimit, hashId } = await import('../core/ratelimit');
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    const perIp = await rateLimit(c.env.DB, `inbox:${hashId(ip)}`, 5, 60 * 60 * 1000); // 5 / hour / IP
    if (!perIp.ok) {
      return c.json(
        { success: false, error: "You're sending notes too fast — Kevin & Jenny need a moment. Try again later." },
        429, { 'Retry-After': String(perIp.retryAfterSec) }
      );
    }
    const global = await rateLimit(c.env.DB, 'inbox:global', 40, 60 * 60 * 1000); // 40 / hour total
    if (!global.ok) {
      return c.json(
        { success: false, error: "Kevin & Jenny are getting a lot of notes right now — please try again soon." },
        429, { 'Retry-After': String(global.retryAfterSec) }
      );
    }

    await dialogueOps.createInboxItem(c.env.DB, {
      author: (body.author || 'anonymous').slice(0, 60),
      content: body.content.trim()
    });

    return c.json({
      success: true,
      data: { queued: true, message: 'Your bottle is at sea. It will wash up on the beach of Sorrel Island soon.' },
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

api.get('/inbox', async (c) => {
  const limit = lim(c.req.query('limit'), 50, 200);
  const offset = lim(c.req.query('offset'), 0, 1_000_000);
  const status = c.req.query('status');
  const items = await dialogueOps.getInboxItems(c.env.DB, { limit, offset, status });
  return c.json({ success: true, data: items });
});

// ── Dialogue (includes island-era turns — src/world/store.ts writes into the same tables) ──

api.get('/dialogue', async (c) => {
  const limit = lim(c.req.query('limit'), 50, 200);
  const offset = lim(c.req.query('offset'), 0, 1_000_000);
  const group = c.req.query('group');
  const turns = await dialogueOps.getDialogueTurns(c.env.DB, { limit, offset, group });
  return c.json({ success: true, data: turns });
});

api.get('/dialogue/groups', async (c) => {
  const limit = lim(c.req.query('limit'), 20, 200);
  const groups = await dialogueOps.getDialogueGroups(c.env.DB, limit);
  return c.json({ success: true, data: groups });
});

// ── Best Ideas ──

api.get('/best-ideas', async (c) => {
  const ideas = await dialogueOps.getBestIdeas(c.env.DB);
  return c.json({ success: true, data: ideas });
});

// ── Log & Stats ──

api.get('/log', async (c) => {
  const limit = lim(c.req.query('limit'), 50, 200);
  const logs = await packetOps.getRecentLogs(c.env.DB, limit);
  return c.json({ success: true, data: logs });
});

api.get('/stats', async (c) => {
  const [counts, typeRows, logs, state, dialogueCount] = await Promise.all([
    legacyCounts(c.env.DB),
    c.env.DB.prepare('SELECT type, COUNT(*) AS n FROM packets GROUP BY type').all<{ type: string; n: number }>(),
    packetOps.getRecentLogs(c.env.DB, 1),
    packetOps.getSystemState(c.env.DB),
    dialogueOps.getDialogueTurnCount(c.env.DB)
  ]);

  // No `coherence` field any more — it was computed by the deleted packet-
  // coherence engine (src/core/coherence.ts). These are cheap counts only.
  const typeBreakdown: Record<string, number> = {};
  for (const r of typeRows.results || []) typeBreakdown[r.type] = r.n;

  return c.json({
    success: true,
    data: {
      total_packets: counts.packets,
      total_connections: counts.connections,
      total_interactions: parseInt(state.total_interactions || '0'),
      total_rewrites: parseInt(state.total_rewrites || '0'),
      total_dialogue_turns: dialogueCount,
      concept_count: counts.concepts,
      type_breakdown: typeBreakdown,
      born_at: state.born_at || null,
      last_active: logs.length > 0 ? logs[0].created_at : null
    }
  });
});

// ── AI Usage ──
// Reads today's counters directly (system_state keys ai_messages_<date> /
// ai_tokens_<date>, written by src/world/tick.ts's budget check) — the old
// helper lived in the deleted src/core/ai_dialogue.ts.

api.get('/ai/usage', async (c) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await c.env.DB.prepare(
    `SELECT key, value FROM system_state WHERE key IN (?, ?)`
  ).bind(`ai_messages_${today}`, `ai_tokens_${today}`).all<{ key: string; value: string }>();
  const byKey: Record<string, string> = {};
  for (const r of rows.results || []) byKey[r.key] = r.value;
  return c.json({
    success: true,
    data: {
      date: today,
      messages_today: parseInt(byKey[`ai_messages_${today}`] || '0') || 0,
      tokens_today: parseInt(byKey[`ai_tokens_${today}`] || '0') || 0,
    },
  });
});

// ── RSS (read-only; island era: no engine reads these into dialogue any more — kept for the archive) ──

api.get('/rss', async (c) => {
  const limit = lim(c.req.query('limit'), 30, 200);
  const status = c.req.query('status');
  const items = status
    ? await rssOps.getRssItemsByStatus(c.env.DB, status, limit)
    : await rssOps.getRecentRssItems(c.env.DB, limit);
  return c.json({ success: true, data: items });
});

api.get('/rss/stats', async (c) => {
  // rss_items stopped growing when the island era retired the RSS pipeline,
  // so a GROUP BY over its ~152k rows can be answered from the edge for a day.
  const stats = await rssOps.getRssStats(c.env.DB);
  return c.json({ success: true, data: stats }, 200, cacheHeaders(CACHE.SEO));
});

// ── Categories ──

api.get('/categories', async (c) => {
  const categories = getAllCategories();
  return c.json({ success: true, data: categories });
});

api.get('/categories/:id/packets', async (c) => {
  const id = c.req.param('id');
  const packets = await packetOps.getPacketsByCategory(c.env.DB, id);
  return c.json({ success: true, data: packets });
});

// ── Self-Editing Rule System (read-only) ──
// The two unauthenticated WRITE routes that used to live here
// (POST /rules/evaluate, POST /rules/reset) are gone: they called the deleted
// src/core/thinking_rules.ts, and this is a public repo — anyone could have
// poked the rule-adoption engine. Local resets: wrangler d1 execute --local.

api.get('/rules', async (c) => {
  const { getActiveRules } = await import('../db/rules');
  const rules = await getActiveRules(c.env.DB);
  const parsed = rules.map(r => ({
    ...r,
    parsed_content: JSON.parse(r.content)
  }));
  return c.json({ success: true, data: parsed });
});

api.get('/rules/proposals', async (c) => {
  const { getRecentProposals } = await import('../db/rules');
  const proposals = await getRecentProposals(c.env.DB, 20);
  return c.json({ success: true, data: proposals });
});

api.get('/rules/adoptions', async (c) => {
  const { getRecentAdoptions } = await import('../db/rules');
  const adoptions = await getRecentAdoptions(c.env.DB, 20);
  return c.json({ success: true, data: adoptions });
});

api.get('/rules/:name', async (c) => {
  const { getActiveRule, getAllVersions } = await import('../db/rules');
  const name = c.req.param('name');
  const rule = await getActiveRule(c.env.DB, name);
  if (!rule) return c.json({ success: false, error: 'Rule not found' }, 404);
  const allVersions = await getAllVersions(c.env.DB, name);
  return c.json({ success: true, data: { active: rule, versions: allVersions } });
});

export default api;
