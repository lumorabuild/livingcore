// Living Core — Main Worker Entry
// Full SSR frontend + API backend

import { Hono } from 'hono';
import api from './routes/api';
import { createViewRoutes } from './routes/views';
import * as dialogueEngine from './core/dialogue';
import * as rssEngine from './core/rss';
import * as rssOps from './db/rss';

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
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
app.get('/__cron', async (c) => {
  const result = await runCronCycle(c.env.DB);
  return c.json(result);
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
// This is what Cloudflare actually calls for cron triggers (every 20 min)
// The HTTP endpoint /__cron above is for manual testing only

export async function scheduled(event: ScheduledEvent, env: Bindings, ctx: ScheduledController) {
  ctx.waitUntil(runCronCycle(env.DB));
}

// ── Shared cron logic ──

async function runCronCycle(db: D1Database) {
  try {
    // Run RSS and thought generation in parallel
    const [rssResult, chainResult] = await Promise.allSettled([
      rssEngine.processRSSFeeds(db),
      generateFullConversationChain(db),
    ]);

    // Check pending rule proposals after everything
    await checkPendingRules(db).catch(() => {});

    return {
      success: true,
      rss: rssResult.status === 'fulfilled' ? rssResult.value : { error: String(rssResult.reason) },
      conversation_generated: chainResult.status === 'fulfilled' ? chainResult.value : false,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ── Full conversation chain from RSS → dialogue ──

async function generateFullConversationChain(db: D1Database): Promise<boolean> {
  // Get latest RSS items
  const recentRss = await rssOps.getRecentRssItems(db, 15);
  const packets = await import('./db/packet').then(m => m.getAllPackets(db));

  // Pick trigger content: latest RSS item, or a random packet, or a fallback thought
  let triggerContent: string;
  let triggerSource: string;

  if (recentRss.length > 0) {
    const rssItem = recentRss[0];
    triggerContent = `📡 RSS: ${rssItem.title}${rssItem.summary ? ' — ' + rssItem.summary : ''}`;
    triggerSource = 'rss';
  } else if (packets.length > 0) {
    const randomPacket = packets[Math.floor(Math.random() * packets.length)];
    triggerContent = randomPacket.content;
    triggerSource = 'memory';
  } else {
    triggerContent = 'The system just started. Two agents, Kevin and Jenny, are here to think together. What should they explore first?';
    triggerSource = 'seed';
  }

  if (!triggerContent || triggerContent.length < 10) return false;

  // Generate the first turn (Kevin starts — he's the Grounder, always leads)
  const { generateId } = await import('./core/dialogue');
  const turnGroup = generateId();

  const firstResult = await dialogueEngine.generateDialogueTurn(
    db,
    triggerContent,
    'kevin',  // Kevin always speaks first
    turnGroup,
    triggerSource
  );

  // Continue the chain for 3 more turns (total 4: Kevin → Jenny → Kevin → Jenny)
  await dialogueEngine.continueDialogueChain(
    db,
    firstResult.turn.content,
    'jenny',  // Jenny responds next
    turnGroup,
    3  // 3 additional turns = 4 total
  ).catch(async (err) => {
    // If chain continuation fails, at least we have the first turn
    const { logAction } = await import('./db/packet');
    await logAction(db, 'system', 'cron_chain_partial', undefined, {
      error: String(err),
      turnsGenerated: 1
    }).catch(() => {});
  });

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
