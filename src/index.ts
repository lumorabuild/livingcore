// Living Core — Main Worker Entry
// A lightweight, self-evolving cognitive architecture
// 
// Two agents, Kevin and Jenny, share one living memory system
// and learn by rewriting their own memory representations over time.
//
// This is the main entry point for the Cloudflare Worker.

import { Hono } from 'hono';
import api from './routes/api';

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
    version: '1.0.0',
    agents: ['Kevin (The Grounder)', 'Jenny (The Weaver)'],
    tagline: 'A tiny artificial mind made of two collaborating agents'
  });
});

// API routes
app.route('/api', api);

// Serve frontend (SPA — fallback to index.html for any non-API route)
app.all('*', async (c) => {
  // For the root and frontend routes, serve the SPA
  try {
    const response = await c.env.ASSETS.fetch(c.req.raw);
    if (response.status === 404) {
      // Fallback to index.html for SPA routing
      return c.env.ASSETS.fetch(new Request('https://placeholder/index.html'));
    }
    return response;
  } catch {
    return c.env.ASSETS.fetch(new Request('https://placeholder/index.html'));
  }
});

export default app;
