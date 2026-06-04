// Living Core — Main Worker Entry
// A tiny artificial mind — two agents, Kevin & Jenny, learning by rewriting memory.
// Phase 0: Living Dialogue — continuous conversation, Idea Inbox, public archive.

import { Hono } from 'hono';
import api from './routes/api';
import * as dialogueEngine from './core/dialogue';

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
    version: '2.0.0',
    agents: ['Kevin (The Grounder)', 'Jenny (The Weaver)'],
    tagline: 'A living thought garden — two agents in continuous dialogue'
  });
});

// Cron trigger — safety net every 20 minutes
app.get('/__cron', async (c) => {
  const result = await dialogueEngine.generateStandaloneThought(c.env.DB);
  return c.json({
    success: true,
    thought_generated: result !== null,
    turn: result?.turn_number || null
  });
});

// API routes
app.route('/api', api);

// Serve frontend (SPA fallback)
app.all('*', async (c) => {
  try {
    const response = await c.env.ASSETS.fetch(c.req.raw);
    if (response.status === 404) {
      return c.env.ASSETS.fetch(new Request('https://placeholder/index.html'));
    }
    return response;
  } catch {
    return c.env.ASSETS.fetch(new Request('https://placeholder/index.html'));
  }
});

export default app;
