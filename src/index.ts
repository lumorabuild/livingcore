// Living Core — Main Worker Entry
// Full SSR frontend + API backend

import { Hono } from 'hono';
import api from './routes/api';
import { createViewRoutes } from './routes/views';
import * as dialogueEngine from './core/dialogue';
import * as rssEngine from './core/rss';

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
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

// Cron trigger — safety net every 20 min, plus RSS fetch
app.get('/__cron', async (c) => {
  try {
    // Run RSS and standalone thought in parallel so one doesn't block the other
    const [rssResult, thoughtResult] = await Promise.allSettled([
      rssEngine.processRSSFeeds(c.env.DB),
      dialogueEngine.generateStandaloneThought(c.env.DB)
    ]);
    return c.json({
      success: true,
      rss: rssResult.status === 'fulfilled' ? rssResult.value : { error: String(rssResult.reason) },
      thought_generated: thoughtResult.status === 'fulfilled' ? thoughtResult.value !== null : false
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
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

export default app;
