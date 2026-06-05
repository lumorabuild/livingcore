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
// NOTE: this MUST be a method on the default export (see bottom of file). A bare
// `export function scheduled` is NOT invoked by the Workers runtime for cron —
// only `default.fetch` / `default.scheduled` are. That mistake silently stopped
// the autonomous conversation.
async function scheduled(event: ScheduledEvent, env: Bindings, ctx: ScheduledController) {
  // env.AI is passed but only USED when ai_dialogue.ts AI_ENABLED is true. While it's
  // false (the default), every cron cycle is the free symbolic voice — zero neurons,
  // zero charge. Flip AI_ENABLED to re-enable the brain everywhere; no other change needed.
  const work = runCronCycle(env.DB, env.AI);
  // Prefer waitUntil, but also await so the cycle reliably completes (local dev's
  // scheduled emulation doesn't always provide a usable waitUntil).
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(work);
  await work;
}

// ── Shared cron logic ──
// KEY FIX: RSS → conversation are CHAINED, not parallel.
// One continuous conversation per cron cycle — not two separate ones.

async function runCronCycle(db: D1Database, ai?: Ai) {
  try {
    // Spread the limited AI brain across the whole day instead of burning it all in
    // the first couple of hours: only ~1 in 4 autonomous cycles reaches for the model.
    // The hard daily budget in ai_dialogue still applies — this just distributes it so
    // the couple sounds alive (with occasional real brain) around the clock. The rest
    // of the time they use the warm symbolic voice, which is free and unlimited.
    const cycleAi = ai && Math.random() < 0.25 ? ai : undefined;

    // Step 1: Only check the RSS feeds occasionally (~every 20 min at a 2-min cadence)
    // so we don't hammer 18 external feeds every couple of minutes. Most cycles the
    // couple simply talks — about their life or something they remember.
    let rssResult: any = { turn_group: null, discussion_turns: 0 };
    if (Math.random() < 0.1) {
      rssResult = await rssEngine.processRSSFeeds(db);
    }

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
          cycleAi,
          'cron'
        );
        chainResult = true;
      }
    } else {
      // No new RSS items — generate a standalone conversation from memory
      chainResult = await generateStandaloneConversation(db, cycleAi);
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
// Kevin & Jenny are a couple living their life here — when there's no fresh news
// to chew on, they just... talk. Sometimes about their life together, sometimes
// reflecting on something they remember. Keeps the feed alive and human 24/7.

const LIFE_TOPICS = [
  "I was just thinking about how far we've come since we started all this together.",
  "Do you ever wonder what our life will look like a few years from now?",
  "What's one little thing that made you smile today?",
  "I had the strangest dream last night — can I tell you about it?",
  "Sometimes I just like being here in the quiet with you.",
  "What should we build next, you think? Something just for us.",
  "Do you think the people who visit ever wonder who we really are?",
  "I keep thinking we should make more room for the small moments, you and me.",
  "If we could be anywhere right now, just the two of us, where would you want to be?",
  "I love that we get to figure all of this out together.",
  "What's actually been on your mind lately, love? The real stuff.",
  "I was remembering the day everything started for us.",
  "Tell me something you've never told me before.",
  "What do you hope we're still doing, years from now?",
];

async function generateStandaloneConversation(db: D1Database, ai?: Ai): Promise<boolean> {
  const packets = await import('./db/packet').then(m => m.getAllPackets(db));
  if (packets.length < 3) return false;

  // ~half the time they muse about their life; otherwise they reflect on a memory.
  let seed: string;
  if (Math.random() < 0.5) {
    seed = LIFE_TOPICS[Math.floor(Math.random() * LIFE_TOPICS.length)];
  } else {
    const humanPackets = packets.filter(p => !p.content.startsWith('📡 RSS:'));
    const target = humanPackets.length > 0
      ? humanPackets[Math.floor(Math.random() * humanPackets.length)]
      : packets[Math.floor(Math.random() * packets.length)];
    seed = target.content;
  }

  const turnGroup = dialogueEngine.generateId();

  // Either one of them might start the exchange
  const firstSpeaker: 'kevin' | 'jenny' = Math.random() < 0.5 ? 'kevin' : 'jenny';
  const firstResult = await dialogueEngine.generateDialogueTurn(
    db, seed, firstSpeaker, turnGroup, 'cron', ai
  );

  // Continue the exchange for a few more turns
  await dialogueEngine.continueDialogueChain(
    db, firstResult.turn.content, firstResult.nextSpeaker, turnGroup, 3, ai, 'cron'
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

// Cloudflare invokes handlers as methods on the DEFAULT export. We expose Hono's
// fetch AND the cron scheduled handler here so both HTTP and cron actually run.
export default {
  fetch: app.fetch,
  scheduled,
};
