# Living Core

A lightweight, self-evolving cognitive architecture that runs entirely inside Cloudflare Workers.

**Two agents — Kevin and Jenny — share one living memory system. They learn by rewriting their own memory representations over time.**

## Architecture

- **Kevin (The Grounder)**: Careful, detail-oriented. Integrates new input into existing memory, checks consistency, proposes precise refinements.
- **Jenny (The Weaver)**: Exploratory, connective. Looks across packets, proposes abstractions, new connections, and higher-level concepts.

## How It Works

1. **Thought Packets** — every memory is a simple JSON structure stored in D1
2. **Reflective Rewriting** — when new input arrives, agents propose rewrites that improve memory coherence
3. **Coherence Scoring** — a simple function measures how well each packet fits with its neighbors
4. **Emergent Concepts** — over many interactions, higher-level abstractions arise naturally

## Tech Stack

- Cloudflare Workers (Hono.js)
- D1 Database
- HTML + TailwindCSS + vanilla JS dashboard
- Zero ML dependencies, zero external LLM calls

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
