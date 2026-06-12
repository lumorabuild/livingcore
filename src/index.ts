// Living Core — Main Worker Entry
// Full SSR frontend + API backend. Kevin & Jenny think through the NVIDIA API
// (OpenAI-compatible, free tier) — see src/core/nvidia.ts for the model registry.

import { Hono } from 'hono';
import api from './routes/api';
import { createViewRoutes } from './routes/views';
import * as dialogueEngine from './core/dialogue';
import * as rssEngine from './core/rss';
import * as dialogueOps from './db/dialogue';
import { noteAiError, AGENTS } from './core/ai_dialogue';

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  NVIDIA_API_KEY: string;
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
    version: '4.0.0',
    agents: [
      `Kevin (${AGENTS.kevin.model.id})`,
      `Jenny (${AGENTS.jenny.model.id})`,
    ],
    brain: 'NVIDIA API (integrate.api.nvidia.com) — no templates, no scripted fallback',
    categories: 14,
    rss_feeds: 18,
  });
});

// Manual cron trigger (HTTP) — for debugging
app.get('/__cron', async (c) => {
  const result = await runCronCycle(c.env.DB, c.env.NVIDIA_API_KEY);
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
// NOTE: this MUST be a method on the default export (see bottom of file). A bare
// `export function scheduled` is NOT invoked by the Workers runtime for cron —
// only `default.fetch` / `default.scheduled` are. That mistake silently stopped
// the autonomous conversation.
async function scheduled(event: ScheduledEvent, env: Bindings, ctx: ScheduledController) {
  const work = runCronCycle(env.DB, env.NVIDIA_API_KEY);
  // Prefer waitUntil, but also await so the cycle reliably completes (local dev's
  // scheduled emulation doesn't always provide a usable waitUntil).
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(work);
  await work;
}

// ── Shared cron logic ──
// Every cycle is the real brain — no dice rolls, no symbolic fallback. A topic keeps
// going across cron cycles (same turn_group) until it reaches a soft cap or winds
// down naturally. When a conversation ends, both agents privately REFLECT on it
// (memories + journal — that's the growth loop), then a fresh one begins.

const TURNS_PER_CYCLE = 2;        // turns added to the live conversation each cron tick
const CONVO_SOFT_CAP = 36;        // a topic can run this many turns before they move on
const KEEP_TALKING_CHANCE = 0.85; // each cycle, odds they stay on the same topic

function randomSpeaker(): 'kevin' | 'jenny' {
  return Math.random() < 0.5 ? 'kevin' : 'jenny';
}

async function runCronCycle(db: D1Database, apiKey?: string) {
  try {
    if (!apiKey) {
      await noteAiError(db, 'cron: NVIDIA_API_KEY is not configured');
      return { success: false, error: 'NVIDIA_API_KEY is not configured' };
    }

    // 0) Recover inbox items whose chain died mid-flight (stuck 'processing').
    await db.prepare(
      "UPDATE inbox SET status = 'pending' WHERE status = 'processing' AND created_at < datetime('now', '-15 minutes')"
    ).run().catch(() => {});

    // 1) Visitor notes get priority — guaranteed pickup even if the original
    //    request-time chain failed (previously they could be stranded forever).
    const pending = await dialogueOps.getInboxItems(db, { limit: 1, status: 'pending' });
    if (pending.length > 0) {
      const item = pending[0];
      const group = dialogueEngine.generateId();
      await dialogueOps.updateInboxStatus(db, item.id, 'processing', group);
      const seed = `[A visitor named "${(item.author || 'anonymous').slice(0, 60)}" left you two a note: "${item.content.slice(0, 600)}"]`;
      const first = await dialogueEngine.generateDialogueTurn(db, seed, randomSpeaker(), group, 'inbox', apiKey);
      if (first) {
        await dialogueEngine.continueDialogueChain(db, first.nextSpeaker, group, TURNS_PER_CYCLE, apiKey, 'inbox');
      } else {
        await dialogueOps.updateInboxStatus(db, item.id, 'pending'); // brain unavailable — retry next cycle
      }
      return { success: true, outcome: 'inbox' };
    }

    // 2) Occasionally check the RSS feeds (~every 20 min on average). Fresh news
    //    starts a new topic thread; we don't hammer 18 external feeds every 2 minutes.
    if (Math.random() < 0.1) {
      const rssResult = await rssEngine.processRSSFeeds(db, apiKey);
      if (rssResult.turn_group && rssResult.discussion_turns > 0) {
        await extendConversation(db, rssResult.turn_group, apiKey);
        return { success: true, outcome: 'news' };
      }
    }

    // 3) The living conversation: continue the current topic, or close it out
    //    (reflection → memories + journals) and open a fresh one.
    const latest = await dialogueOps.getDialogueTurns(db, { limit: 1 });
    const activeGroup = latest.length > 0 ? latest[0].turn_group : null;
    let count = 0;
    if (activeGroup) {
      count = (await dialogueOps.getDialogueTurns(db, { group: activeGroup, limit: CONVO_SOFT_CAP + 10 })).length;
    }

    let outcome: string;
    if (activeGroup && count < CONVO_SOFT_CAP && Math.random() < KEEP_TALKING_CHANCE) {
      await extendConversation(db, activeGroup, apiKey);
      outcome = 'continued';
    } else {
      // Growth first: both agents privately digest the finished conversation.
      if (activeGroup) {
        await dialogueEngine.reflectOnGroup(db, apiKey, activeGroup).catch(() => {});
      }
      const group = dialogueEngine.generateId();
      const first = await dialogueEngine.generateDialogueTurn(db, '', randomSpeaker(), group, 'cron', apiKey);
      if (first) {
        await dialogueEngine.continueDialogueChain(db, first.nextSpeaker, group, TURNS_PER_CYCLE - 1, apiKey, 'cron');
      }
      outcome = 'new';
    }

    await checkPendingRules(db).catch(() => {});

    return { success: true, outcome };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// Add a few more turns to an existing conversation thread (same turn_group).
async function extendConversation(db: D1Database, turnGroup: string, apiKey: string): Promise<void> {
  const groupTurns = await dialogueOps.getDialogueTurns(db, { group: turnGroup, limit: 1 });
  if (groupTurns.length === 0) return;
  const nextSpeaker = groupTurns[0].speaker === 'kevin' ? 'jenny' : 'kevin';
  await dialogueEngine.continueDialogueChain(db, nextSpeaker, turnGroup, TURNS_PER_CYCLE, apiKey, 'cron');
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
      reasons: result.reasons.join('; '),
    }).catch(() => {});
  }
}

// Cloudflare invokes handlers as methods on the DEFAULT export. We expose Hono's
// fetch AND the cron scheduled handler here so both HTTP and cron actually run.
export default {
  fetch: app.fetch,
  scheduled,
};
