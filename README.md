# Living Core

A lightweight, self-evolving cognitive architecture that runs entirely inside Cloudflare Workers.

**Kevin and Jenny — a husband and wife — share one living memory and use Workers AI to have real conversations. They learn by rewriting their own memory representations over time.**

## Architecture

- **Kevin** (`@cf/ibm-granite/granite-4.0-h-micro`): The grounded husband. Careful, detail-oriented. Integrates new input into existing memory, checks consistency, anchors ideas to what they know.
- **Jenny** (`@cf/zai-org/glm-4.7-flash`): The weaving wife. Exploratory, connective. Finds patterns across memories, proposes abstractions, makes unexpected connections.

## How It Works

1. **Thought Packets** — every memory is a simple JSON structure stored in D1
2. **Workers AI Dialogue** — Kevin and Jenny use real AI models to have genuine conversations
3. **Rate Limiting** — each agent gets 8 AI calls/day (half the free tier, ~5k neurons), with automatic fallback to symbolic generation
4. **Reflective Rewriting** — when new input arrives, agents propose rewrites that improve memory coherence
5. **Coherence Scoring** — a simple function measures how well each packet fits with its neighbors
6. **Emergent Concepts** — over many interactions, higher-level abstractions arise naturally

## Tech Stack

- Cloudflare Workers (Hono.js)
- D1 Database (SQLite)
- Workers AI (`@cf/ibm-granite/granite-4.0-h-micro` + `@cf/zai-org/glm-4.7-flash`)
- HTML + TailwindCSS + vanilla JS dashboard

## Development

```bash
npm install
wrangler d1 migrations apply livingcore --local
npm run dev
```

## Deployment

```bash
npm run deploy
```
