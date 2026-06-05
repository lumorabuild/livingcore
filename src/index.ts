// Living Core — Main Worker Entry
// Full SSR frontend + API backend

import { Hono } from 'hono';
import api from './routes/api';
import { createViewRoutes } from './routes/views';
import * as dialogueEngine from './core/dialogue';
import * as rssEngine from './core/rss';
import * as rssOps from './db/rss';
import * as dialogueOps from './db/dialogue';

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  AI: Ai;
};

type ScheduledController = {
  waitUntil: (promise: Promise<any>) => void;
};

const app = new Hono<{ Bindings: Bindings }>();

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'alive',
    name: 'Living Core',
    version: '3.0.0',
    agents: ['Kevin (The Grounder)', 'Jenny (The Weaver)'],
    tagline: 'SSR frontend — SEO-friendly living thought garden',
    categories: 14,
    rss_feeds: 18
  });
});

// Manual cron trigger (HTTP) — for debugging
// Cron may use the AI brain too, but capped (CRON_AI_CAP) so it can't drain the
// daily budget — user-driven inbox conversations always keep brain budget in reserve.
app.get('/__cron', async (c) => {
  const result = await runCronCycle(c.env.DB, c.env.AI);
  return c.json(result);
});

// SSE endpoint for live polling — returns latest state + new turns
app.get('/api/poll', async (c) => {
  const lastTurnId = parseInt(c.req.query('since') || '0');

  const [state, dialogueCount, newTurns] = await Promise.all([
    import('./db/packet').then(m => m.getFullState(c.env.DB)),
    dialogueOps.getDialogueTurnCount(c.env.DB),
    lastTurnId > 0
      ? dialogueOps.getDialogueTurnsAfter(c.env.DB, lastTurnId)
      : dialogueOps.getDialogueTurns(c.env.DB, { limit: 10 }),
  ]);

  return c.json({
    dialogue_turns: dialogueCount,
    latest_turn_id: newTurns.length > 0 ? Math.max(...newTurns.map(t => t.id)) : lastTurnId,
    new_turns: newTurns,
    coherence: parseFloat(state.system_state?.avg_coherence || '0.4'),
    packet_count: state.packets?.length || 0,
  });
});

// SSR page routes (must be before static asset fallback)
createViewRoutes(app);

// API routes
app.route('/api', api);

// Static assets (script.js, etc.) — only for non-HTML routes
app.get('/script.js', async (c) => {
  try {
    const response = await c.env.ASSETS.fetch(c.req.raw);
    return response;
  } catch {
    return c.text('// script not found', 404);
  }
});

// 404 fallback — redirect to home
app.all('*', (c) => {
  return c.redirect('/');
});

// ── SCHEDULED EVENT HANDLER ──
// Cloudflare calls this for cron triggers (now every 1 min for testing)

export async function scheduled(event: ScheduledEvent, env: Bindings, ctx: ScheduledController) {
  // Cron may use the AI brain (capped), with budget reserved for inbox testing.
  ctx.waitUntil(runCronCycle(env.DB, env.AI));
}

// ── Shared cron logic ──
// KEY FIX: RSS → conversation are CHAINED, not parallel.
// One continuous conversation per cron cycle — not two separate ones.

async function runCronCycle(db: D1Database, ai?: Ai) {
  try {
    // Step 1: Process RSS feeds — generates 3 discussion turns
    const rssResult = await rssEngine.processRSSFeeds(db);

    // Step 2: CHAIN from where RSS left off — same turn_group
    // This creates ONE flowing conversation instead of two separate ones
    let chainResult = false;
    if (rssResult.turn_group && rssResult.discussion_turns > 0) {
      // Get the newest turn in the RSS discussion to continue from it
      const groupTurns = await dialogueOps.getDialogueTurns(db, {
        group: rssResult.turn_group,
        limit: 10
      });

      if (groupTurns.length > 0) {
        // groupTurns[0] is newest (DESC ordering)
        const newestTurn = groupTurns[0];
        const nextSpeaker = newestTurn.speaker === 'kevin' ? 'jenny' : 'kevin';

        await dialogueEngine.continueDialogueChain(
          db,
          newestTurn.content,
          nextSpeaker,
          rssResult.turn_group,
          3,  // 3 additional turns → total: 6 turns in one continuous conversation
          ai,
          'cron'
        );
        chainResult = true;
      }
    } else {
      // No new RSS items — generate a standalone conversation from memory
      chainResult = await generateStandaloneConversation(db, ai);
    }

    // Step 3: Check pending rule proposals
    await checkPendingRules(db).catch(() => {});

    return {
      success: true,
      rss: rssResult,
      conversation_generated: chainResult,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ── Standalone conversation (when no new RSS items) ──

async function generateStandaloneConversation(db: D1Database, ai?: Ai): Promise<boolean> {
  const packets = await import('./db/packet').then(m => m.getAllPackets(db));
  if (packets.length < 3) return false;

  // Pick a random packet that's NOT an RSS observation (prefer human content)
  const humanPackets = packets.filter(p => !p.content.startsWith('📡 RSS:'));
  const target = humanPackets.length > 0
    ? humanPackets[Math.floor(Math.random() * humanPackets.length)]
    : packets[Math.floor(Math.random() * packets.length)];

  const turnGroup = dialogueEngine.generateId();

  // Kevin speaks first
  const firstResult = await dialogueEngine.generateDialogueTurn(
    db, target.content, 'kevin', turnGroup, 'cron', ai
  );

  // Continue for 3 more turns → total: 4 turns
  await dialogueEngine.continueDialogueChain(
    db, firstResult.turn.content, 'jenny', turnGroup, 3, ai, 'cron'
  ).catch(() => {});

  return true;
}

// ── Check pending rule proposals after cron ──

async function checkPendingRules(db: D1Database) {
  const { getSystemState } = await import('./db/packet');
  const { checkPendingProposals } = await import('./core/thinking_rules');

  const stateRaw = await getSystemState(db);
  const coherenceVal = parseFloat(stateRaw.avg_coherence || '0.4');
  const result = await checkPendingProposals(db, coherenceVal);

  if (result.adopted > 0) {
    const { logAction } = await import('./db/packet');
    await logAction(db, 'system', 'rules_adopted', undefined, {
      count: result.adopted,
      reasons: result.reasons.join('; ')
    }).catch(() => {});
  }
}

export default app;
