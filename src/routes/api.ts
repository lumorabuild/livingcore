// REST API Routes for Living Core — Phase 0 (Dialogue + Inbox + Archive)
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as packetOps from '../db/packet';
import * as rssOps from '../db/rss';
import * as coherenceFunc from '../core/coherence';
import * as dialogueOps from '../db/dialogue';
import * as dialogueEngine from '../core/dialogue';
import * as rssEngine from '../core/rss';
import { processInput } from '../core/loop';
import { getAllCategories } from '../core/categories';

type Bindings = { DB: D1Database };

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

// ── Input (existing experience processing) ──

api.post('/input', async (c) => {
  const body = await c.req.json<{ content: string }>();
  if (!body.content || body.content.trim().length === 0) {
    return c.json({ success: false, error: 'Content is required' }, 400);
  }
  const result = await processInput(c.env.DB, body.content.trim());
  return c.json({ success: true, data: result });
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

    // Generate first turn synchronously so the frontend gets immediate response
    const firstTurn = await dialogueEngine.generateDialogueTurn(
      c.env.DB, item.content, firstSpeaker, turnGroup, 'inbox'
    );

    // Chain continues in background (registered with waitUntil)
    runInBackground(c, async () => {
      await dialogueEngine.continueDialogueChain(
        c.env.DB, firstTurn.turn.content, firstTurn.nextSpeaker, turnGroup, 3
      );
      // Also evaluate pending proposals in the same background task
      try {
        const { checkPendingProposals } = await import('../core/thinking_rules');
        const state = await packetOps.getSystemState(c.env.DB);
        const coherence = parseFloat(state.avg_coherence || '0.4');
        await checkPendingProposals(c.env.DB, coherence);
      } catch (err) {
        // Silently handle — rule evaluation is non-critical
      }
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

// ── RSS ──

api.post('/rss/fetch', async (c) => {
  const result = await rssEngine.processRSSFeeds(c.env.DB);
  return c.json({ success: true, data: result });
});

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

// ── Categorize existing packets (one-time migration helper) ──

api.post('/admin/categorize', async (c) => {
  const { classifyText } = await import('../core/categories');
  const packets = await packetOps.getAllPackets(c.env.DB);
  let updated = 0;
  for (const p of packets) {
    if (p.primary_category) continue; // already categorized
    const result = classifyText(p.content);
    await packetOps.updatePacket(c.env.DB, p.id, {
      primary_category: result.primary,
      secondary_categories: result.secondaries
    });
    updated++;
  }
  return c.json({ success: true, data: { updated, total: packets.length } });
});

// ── Manual Think (trigger next turn) ──

api.post('/think', async (c) => {
  const raw = await c.req.text().catch(() => '{}');
  const body: Record<string, string> = JSON.parse(raw);
  const speaker: 'kevin' | 'jenny' = body.speaker === 'jenny' ? 'jenny' : 'kevin';
  const content = body.content || 'Continue our conversation...';

  const result = await dialogueEngine.generateDialogueTurn(
    c.env.DB, content, speaker, undefined, 'manual'
  );

  // Chain continues in background
  runInBackground(c, async () => {
    await dialogueEngine.continueDialogueChain(
      c.env.DB, result.turn.content, result.nextSpeaker, result.turnGroup, 2
    );
  });

  return c.json({ success: true, data: result });
});

// ── Reset (dev only) ──

api.post('/reset', async (c) => {
  await c.env.DB.prepare('DELETE FROM best_ideas').run();
  await c.env.DB.prepare('DELETE FROM inbox').run();
  await c.env.DB.prepare('DELETE FROM dialogue_turns').run();
  await c.env.DB.prepare('DELETE FROM agent_log').run();
  await c.env.DB.prepare('DELETE FROM connections').run();
  await c.env.DB.prepare('DELETE FROM packets').run();
  await c.env.DB.prepare("UPDATE system_state SET value = '0' WHERE key IN ('total_interactions', 'total_rewrites', 'total_dialogue_turns', 'turn_sequence')").run();
  await c.env.DB.prepare("UPDATE system_state SET value = '0.0' WHERE key = 'avg_coherence'").run();
  await c.env.DB.prepare("UPDATE system_state SET value = '0' WHERE key = 'concept_count'").run();
  await c.env.DB.prepare("UPDATE system_state SET value = '' WHERE key = 'born_at'").run();
  return c.json({ success: true, message: 'System reset complete (all dialogue, inbox, packets cleared)' });
});

// ── Self-Editing Rule System ──

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
