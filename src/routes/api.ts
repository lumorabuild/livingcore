// REST API Routes for Living Core — Phase 0 (Dialogue + Inbox + Archive)
// NOTE: this repo is PUBLIC and these routes are unauthenticated. Only read
// endpoints and the intended visitor channel (inbox) belong here — anything
// destructive or budget-burning must not be exposed.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as packetOps from '../db/packet';
import * as rssOps from '../db/rss';
import * as coherenceFunc from '../core/coherence';
import * as dialogueOps from '../db/dialogue';
import * as dialogueEngine from '../core/dialogue';
import { getAllCategories } from '../core/categories';

type Bindings = { DB: D1Database; NVIDIA_API_KEY: string };

const api = new Hono<{ Bindings: Bindings }>();

// Helper to run background tasks with proper waitUntil
function runInBackground(c: any, fn: () => Promise<void>) {
  try {
    const ctx: ExecutionContext = (c as any).executionCtx;
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(fn());
    } else {
      // Fallback: just fire and hope
      fn();
    }
  } catch {
    fn();
  }
}

api.use('/*', cors());

// ── State ──

api.get('/state', async (c) => {
  const [state, dialogueCount, pendingInbox] = await Promise.all([
    packetOps.getFullState(c.env.DB),
    dialogueOps.getDialogueTurnCount(c.env.DB),
    dialogueOps.getPendingInboxCount(c.env.DB)
  ]);

  // Include rule system data
  const { getActiveRules, getPendingProposals, getRecentProposals, getRecentAdoptions } = await import('../db/rules');
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
  if (type) packets = await packetOps.getPacketsByType(c.env.DB, type as any);
  else if (search) packets = await packetOps.searchPackets(c.env.DB, search);
  else packets = await packetOps.getAllPackets(c.env.DB);
  return c.json({ success: true, data: packets });
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

// ── Idea Inbox ──

api.post('/inbox', async (c) => {
  try {
    const body = await c.req.json<{ content: string; author?: string }>();
    if (!body.content || body.content.trim().length === 0) {
      return c.json({ success: false, error: 'Content is required' }, 400);
    }

    const item = await dialogueOps.createInboxItem(c.env.DB, {
      author: body.author || 'anonymous',
      content: body.content.trim()
    });

    // Trigger dialogue chain in background
    const firstSpeaker: 'kevin' | 'jenny' = Math.random() > 0.5 ? 'kevin' : 'jenny';
    const turnGroup = packetOps.generateId();

    await dialogueOps.updateInboxStatus(c.env.DB, item.id, 'processing', turnGroup);

    // Generate first turn synchronously so the frontend gets immediate response.
    // The note reaches the agents as a mechanism marker — what they say about it is theirs.
    const seed = `[A visitor named "${(item.author || 'anonymous').slice(0, 60)}" left you two a note: "${item.content.slice(0, 600)}"]`;
    const firstTurn = await dialogueEngine.generateDialogueTurn(
      c.env.DB, seed, firstSpeaker, turnGroup, 'inbox', c.env.NVIDIA_API_KEY
    );

    if (!firstTurn) {
      // Brain unavailable right now — leave the note pending; cron picks it up shortly.
      await dialogueOps.updateInboxStatus(c.env.DB, item.id, 'pending');
      return c.json({
        success: true,
        data: { inbox_item: item, first_turn: null, turn_group: null, next_speaker: null, queued: true }
      });
    }

    // Chain continues in background (registered with waitUntil)
    runInBackground(c, async () => {
      await dialogueEngine.continueDialogueChain(
        c.env.DB, firstTurn.nextSpeaker, turnGroup, 3, c.env.NVIDIA_API_KEY, 'inbox'
      );
    });

    return c.json({
      success: true,
      data: {
        inbox_item: item,
        first_turn: firstTurn.turn,
        turn_group: turnGroup,
        next_speaker: firstTurn.nextSpeaker
      }
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

api.get('/inbox', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');
  const status = c.req.query('status');
  const items = await dialogueOps.getInboxItems(c.env.DB, { limit, offset, status });
  return c.json({ success: true, data: items });
});

// ── Dialogue ──

api.get('/dialogue', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');
  const group = c.req.query('group');
  const turns = await dialogueOps.getDialogueTurns(c.env.DB, { limit, offset, group });
  return c.json({ success: true, data: turns });
});

api.get('/dialogue/groups', async (c) => {
  const limit = parseInt(c.req.query('limit') || '20');
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
  const limit = parseInt(c.req.query('limit') || '50');
  const logs = await packetOps.getRecentLogs(c.env.DB, limit);
  return c.json({ success: true, data: logs });
});

api.get('/stats', async (c) => {
  const [packets, connections, logs, state, dialogueCount] = await Promise.all([
    packetOps.getAllPackets(c.env.DB),
    packetOps.getAllConnections(c.env.DB),
    packetOps.getRecentLogs(c.env.DB, 1),
    packetOps.getSystemState(c.env.DB),
    dialogueOps.getDialogueTurnCount(c.env.DB)
  ]);

  const coherence = await coherenceFunc.calculateGlobalCoherence(
    c.env.DB,
    () => packetOps.getAllPackets(c.env.DB),
    () => packetOps.getAllConnections(c.env.DB)
  );

  const conceptPackets = packets.filter(p => p.type === 'concept');
  const typeBreakdown: Record<string, number> = {};
  for (const p of packets) typeBreakdown[p.type] = (typeBreakdown[p.type] || 0) + 1;

  return c.json({
    success: true,
    data: {
      total_packets: packets.length,
      total_connections: connections.length,
      total_interactions: parseInt(state.total_interactions || '0'),
      total_rewrites: parseInt(state.total_rewrites || '0'),
      total_dialogue_turns: dialogueCount,
      avg_coherence: coherence.avg_coherence,
      concept_count: conceptPackets.length,
      type_breakdown: typeBreakdown,
      born_at: state.born_at || null,
      last_active: logs.length > 0 ? logs[0].created_at : null
    }
  });
});

// ── AI Usage ──

api.get('/ai/usage', async (c) => {
  const { getAiDailyUsage } = await import('../core/ai_dialogue');
  const usage = await getAiDailyUsage(c.env.DB);
  return c.json({ success: true, data: usage });
});

// ── RSS (read-only; fetching happens on the cron schedule) ──

api.get('/rss', async (c) => {
  const limit = parseInt(c.req.query('limit') || '30');
  const status = c.req.query('status');
  const items = status
    ? await rssOps.getRssItemsByStatus(c.env.DB, status, limit)
    : await rssOps.getRecentRssItems(c.env.DB, limit);
  return c.json({ success: true, data: items });
});

api.get('/rss/stats', async (c) => {
  const stats = await rssOps.getRssStats(c.env.DB);
  return c.json({ success: true, data: stats });
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

// ── Self-Editing Rule System ──
// (The old unauthenticated POST /reset, /think, /input, /admin/categorize and
//  /rss/fetch routes are intentionally GONE: this is a public repo, and those
//  let anyone wipe the couple's accumulated life, inject topics into the live
//  feed, or burn the daily AI budget. Local resets: wrangler d1 execute --local.)

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

api.post('/rules/evaluate', async (c) => {
  try {
    const { checkPendingProposals } = await import('../core/thinking_rules');
    const state = await packetOps.getSystemState(c.env.DB);
    const coherence = parseFloat(state.avg_coherence || '0.4');
    const result = await checkPendingProposals(c.env.DB, coherence);
    return c.json({ success: true, data: result });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

api.post('/rules/reset', async (c) => {
  // Reset stuck proposals (evaluating -> pending)
  await c.env.DB.prepare(
    "UPDATE rule_proposals SET status = 'pending', evaluated_at = NULL WHERE status = 'evaluating'"
  ).run();
  return c.json({ success: true, message: 'Stuck proposals reset to pending' });
});

export default api;
