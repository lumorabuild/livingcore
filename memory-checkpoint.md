# Living Core — Launch Session (2026-06-04)

## What was built
Complete Living Core system deployed on Cloudflare Workers:

### Workers
- `src/index.ts` — Main Hono entry, routes `/health`, `/api/*`, and SPA fallback
- `src/routes/api.ts` — REST API: state, packets CRUD, input processing, stats, reset
- `src/db/schema.ts` — TypeScript types for ThoughtPacket, connections, logs
- `src/db/packet.ts` — Full D1 CRUD: packets, connections, agent_log, system_state
- `src/core/coherence.ts` — 3-dimension coherence scoring (density, consistency, temporal)
- `src/core/kevin.ts` — Kevin (The Grounder): keyword matching, refinement proposals, consistency checks
- `src/core/jenny.ts` — Jenny (The Weaver): tag clustering, concept detection, connection proposals
- `src/core/loop.ts` — Orchestration: both agents process input, proposals scored, high-coherence applied
- `migrations/0000_init.sql` — D1 schema with indexes

### Frontend
- `public/index.html` — Beautiful dark-theme dashboard with Tailwind CSS
  - Vital signs (packets, connections, interactions, rewrites, coherence, concepts, born)
  - Input box for submitting experiences
  - Kevin + Jenny thought panels (side by side, animated)
  - Tabs: Memory (packet cards), Concepts, Activity Log, Graph View
  - Live polling every 5 seconds

### Deployed At
- **URL:** https://livingcore.cc and https://livingcore.lumorabuild.workers.dev
- **GitHub:** https://github.com/lumorabuild/livingcore.git (main branch)
- **D1 Database:** livingcore (d599879f-2195-4fe5-99c1-5c845d01683f)

## Verification
- Health endpoint: ✅ Returns JSON with agents info
- Stats endpoint: ✅ Shows packet count, coherence, etc.
- Input processing: ✅ 3 test inputs processed successfully
  - After 3 interactions: 9 packets, 1 concept ("kevin + jenny"), coherence ~50%
- TypeScript: ✅ `npx tsc --noEmit` clean
- Deploy: ✅ `npx wrangler deploy` successful
- Git: ✅ committed and pushed

## Architecture Notes
- No LLM calls, no embeddings — pure symbolic processing
- Learning mechanism: reflective rewriting + coherence scoring
- Coherence = connection_density × 0.4 + semantic_consistency × 0.35 + temporal_stability × 0.25
- Phase 1 done: data model, packet ops, agent loop, live dashboard
- Ready for Phase 2+: improve agent reasoning, better coherence, concept formation refinement
