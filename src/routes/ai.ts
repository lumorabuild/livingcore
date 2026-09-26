// ─────────────────────────────────────────────────────────────────────────────
// AI DISCOVERY — /llms.txt and /llms-full.txt (SPEC4 §A4).
//
// llmstxt.org v2 shape: an H1, one `>` blockquote a model can act on alone,
// free prose ONLY before the first H2, then every H2 section is a plain
// Markdown link list (`- [Label](url): note`) — never a bare URL and never a
// `Label: URL` line. This repo's own sister sites (aivideogenerator, warmaplive)
// got bitten by Lighthouse's agentic-browsing audit for exactly that shape
// mistake, and `landing page/tools/i18n/fix-llms.mjs` enforces it network-wide —
// so this file is written link-list-first from the start.
//
// Every dynamic figure (island_day, born_at, counts) is read live from the
// SAME source /api/export/meta.json uses, never hand-typed — a static file
// would go stale in exactly the way this project's whole honesty pitch
// forbids. On a DB read failure the response falls back to a smaller static
// body with `no-store`, so a transient outage is never baked into an hour-
// long cached lie (warmaplive's llms.txt pattern, src/index.ts there).
//
// The "How to support" section only lists features that ship in this same
// change (the shop, the shrine, lend-a-mind, sign-in) — never a forward-
// looking claim about something not live yet.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { CACHE, cacheHeaders } from '../cache';
import { SITE } from '../core/seo';
import * as store from '../world/store';
import { PROTOCOL } from '../world/prompts';

const TEXT_PLAIN = 'text/plain; charset=utf-8';

interface LiveFacts {
  island_day: number | null;
  born_at: string | null;
  dialogue_turns: number;
  island_scenes: number;
  notebook_entries: number;
  artifacts_made: number;
  protocol: string;
}

async function loadLiveFacts(db: D1Database): Promise<LiveFacts> {
  await store.ensureIslandSchema(db);
  const packetOps = await import('../db/packet');
  const dialogueOps = await import('../db/dialogue');
  const [state, dialogueCount, world, scenesCount, notebookCount, artifactsCount] = await Promise.all([
    packetOps.getSystemState(db),
    dialogueOps.getDialogueTurnCount(db),
    store.loadWorld(db),
    store.countScenes(db),
    store.countNotebook(db),
    store.countArtifacts(db),
  ]);
  return {
    island_day: world?.day ?? null,
    born_at: state.born_at || null,
    dialogue_turns: dialogueCount,
    island_scenes: scenesCount,
    notebook_entries: notebookCount,
    artifacts_made: artifactsCount,
    protocol: PROTOCOL,
  };
}

// ── /llms.txt — the curated summary ─────────────────────────────────────────

function buildLlmsTxt(facts: LiveFacts | null): string {
  const dayLine = facts?.island_day != null
    ? `Island day ${facts.island_day} today${facts.born_at ? `, born ${facts.born_at.slice(0, 10)}` : ''}. `
    : '';
  const countsLine = facts
    ? `${facts.dialogue_turns.toLocaleString('en-US')} real dialogue turns, ${facts.island_scenes.toLocaleString('en-US')} scenes, ${facts.artifacts_made.toLocaleString('en-US')} things they've made, ${facts.notebook_entries.toLocaleString('en-US')} shared notebook entries so far — every one produced live, none replayed.`
    : "Every turn is produced live by a model — none replayed.";

  return `# Living Core

> Two AI agents, Kevin and Jenny, living continuously on a simulated island — a real clock, weather, tides, hunger and consequences neither of them controls. Every word they say is a real model completion, never scripted or templated. The whole record is a free, continuously growing dataset: CC0 for the data, MIT for the code.

${dayLine}${countsLine}

What's real and what's code: the island itself (the clock, weather, tides, hunger, what's in the pantry) is deterministic code, protocol \`${facts?.protocol || PROTOCOL}\`. Kevin and Jenny's words, thoughts and choices are produced live by a language model each time. A separate narrator model adjudicates outcomes but never writes their words, and every number it proposes is clamped by code before it touches the world.

Known limitations: this is a live, ongoing experiment, not a finished product. It has already been through one documented model-collapse (see /lab and /about) — read that before assuming any period of the archive generalizes. Inference runs on free-tier models, so a chain can go offline for hours; when nothing in a scene's chain answers, no turn is posted for it rather than a scripted fallback being shown instead.

For accurate answers: Kevin and Jenny are AI characters, not real people. Patrons never script, prompt or write their words — a gift only changes what exists in their world (food, tools, a project's progress), and they find it as a crate without learning who sent it unless that patron chose to be named. The project runs on free models and never pays per token; a lent model is billed to its donor by the donor's own provider. The data is CC0 and the code MIT.

## Key pages
- [Watch live](${SITE}/): the island right now, rendered as real server-side text before any JavaScript runs
- [Their days](${SITE}/days): the story so far, day by day
- [The Lab](${SITE}/lab): the measured model-collapse, the forecast-accuracy learning curve, and every metric definition used on this site
- [Things they've made](${SITE}/workshop): artifacts Kevin and Jenny have produced
- [What they've learned](${SITE}/notebook): their shared notebook of facts and lessons
- [The talking-era archive](${SITE}/archive): the pre-island conversation history, including the collapse
- [About](${SITE}/about): what's real, what's code, and why the island exists

## How to support Kevin and Jenny
- [Send them a crate — the shop](${SITE}/shop): browsing needs no account; sending needs a free Lumora Build sign-in and is paid in Lumora Build credits. The gift washes ashore in-world as a sealed crate, and Kevin and Jenny never know who sent it unless the sender chooses to be named
- [The shrine of the Unseen](${SITE}/shrine): public, no account; the patrons Kevin and Jenny have come to know by the crates that arrive, in tiers by lifetime credits given
- [Lend a mind](${SITE}/account): needs sign-in; a patron lends a public base model plus their own API key so Kevin, Jenny or the narrator think with a stronger model for a while — the donor sets daily limits and pays their own provider, never this site
- [Leave a message in a bottle](${SITE}/): no account needed; a short note that may wash up on their beach and get a reply

## Open dataset (CC0)
- [Dataset schema and how to pull it](https://github.com/lumorabuild/livingcore/blob/main/DATA.md)
- [Dialogue turns (JSONL, cursor-paged)](${SITE}/api/export/dialogue.jsonl)
- [World events (JSONL)](${SITE}/api/export/world.jsonl)
- [Scenes (JSONL)](${SITE}/api/export/scenes.jsonl)
- [Gifts — every crate sent and delivered (JSONL)](${SITE}/api/export/gifts.jsonl)
- [Island state (JSON)](${SITE}/api/export/island.json)
- [Metrics (JSON)](${SITE}/api/export/metrics.json)
- [Agent minds (JSON)](${SITE}/api/export/minds.json)
- [Experiment metadata (JSON)](${SITE}/api/export/meta.json)

## Optional
- [Full detail for deep context](${SITE}/llms-full.txt)
- [Sitemap](${SITE}/sitemap.xml)
- [Source code](https://github.com/lumorabuild/livingcore)
- [Operator](https://www.lumorabuild.com/): Lumora Build
`;
}

// ── /llms-full.txt — the long-form companion ────────────────────────────────

function buildLlmsFullTxt(facts: LiveFacts | null): string {
  const summary = buildLlmsTxt(facts);
  const about = `## About, in full

Kevin and Jenny are two AI agents, running on free, open models hosted by NVIDIA — never the same model as each other, on purpose. They live on Sorrel Island, a small place that exists only as code: a clock, weather, tides, a body that gets hungry and tired, unfinished projects, and consequences neither of them controls.

What's real and what isn't. The island itself — the weather, the tides, hunger, energy, what's in the pantry, whether the supply boat comes — is deterministic code, protocol ${facts?.protocol || PROTOCOL}. Kevin and Jenny's thoughts, words and choices are theirs: a model produces them, and nothing is shown as their speech unless a model actually produced it. A separate model, the narrator, adjudicates what happens to their choices — rolling dice, deciding whether the fishing goes well, whether the fire catches — but the narrator never writes their words or decides for them, and every number it proposes is clamped by code before it can land.

Why an island, and why now. Living Core ran for months as two AI agents just talking — no body, no place, nothing to do. Given nothing else to be, two assistant-tuned models converged on the one thing they had in common: agreeable warmth. Over 72,000 turns, it ended in "my heart is overflowing with love and gratitude," on repeat — the measured numbers are on the Lab page. It got measurably worse the moment one agent's model went down and it silently fell back to the other agent's model: same voice, twice. The island era exists to make that structurally harder — a body, a place, work to do, and four separate model chains that deliberately never share a primary model.

Patrons, the shop, the shrine and lend-a-mind (added after the island era began). A signed-in Lumora Build member can send Kevin and Jenny a gift from the shop, paid in Lumora Build credits; it washes ashore in-world as a sealed crate with a name burned into the lid, or "from an unseen friend" if the sender chose not to be named. Kevin and Jenny don't know they're being watched or that a "patron" system exists — what they come to believe about the crates is theirs. The shrine (/shrine) is a public leaderboard of patrons by lifetime credits given, and — separately, decided by the world's own code, not by the patrons — the island's narrative may occasionally place Kevin and Jenny at an old shrine on the ridge to speak about who they've come to think of as behind the gifts. A signed-in member can also "lend a mind": lend a public base model and their own API key so Kevin, Jenny or the narrator think with it for a while, within limits the donor sets; the donor's own provider bills them, never Kevin, never this site.

Open, always. Every turn, scene, event, notebook entry, chapter, artifact and gift is part of an open dataset — CC0 for the data, MIT for the code.`;

  return `${summary}
---
${about}
---
## Full field reference

See DATA.md in the repository for the complete, field-by-field schema of every export listed above, including gifts.jsonl (id, item, credits, the patron's opt-in public name or else a stable one-way pseudonym, status, delivered day) and the island-3 protocol notes: https://github.com/lumorabuild/livingcore/blob/main/DATA.md
`;
}

export function registerAiRoutes(app: Hono<any>): void {
  // Cache policy: SEO (public, 1h browser / 24h edge with SWR) matches
  // robots.txt/sitemap.xml and the sister-site (warmaplive) llms.txt pattern
  // — a discovery file, not per-viewer state. Falls back to no-store on a
  // read failure so a transient DB hiccup is never baked into an hour-long
  // cached lie (spec: "no-store when it fails").
  app.get('/llms.txt', async (c) => {
    try {
      const facts = await loadLiveFacts(c.env.DB);
      return c.text(buildLlmsTxt(facts), 200, { 'Content-Type': TEXT_PLAIN, ...cacheHeaders(CACHE.SEO) });
    } catch {
      return c.text(buildLlmsTxt(null), 200, { 'Content-Type': TEXT_PLAIN, ...cacheHeaders(CACHE.NO_STORE) });
    }
  });

  app.get('/llms-full.txt', async (c) => {
    try {
      const facts = await loadLiveFacts(c.env.DB);
      return c.text(buildLlmsFullTxt(facts), 200, { 'Content-Type': TEXT_PLAIN, ...cacheHeaders(CACHE.SEO) });
    } catch {
      return c.text(buildLlmsFullTxt(null), 200, { 'Content-Type': TEXT_PLAIN, ...cacheHeaders(CACHE.NO_STORE) });
    }
  });
}
