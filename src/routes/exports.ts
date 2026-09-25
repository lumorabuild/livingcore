// Open dataset exports — read-only, documented in DATA.md. Mounted at
// /api/export in src/index.ts, BEFORE the generic /api router, so these routes
// win over anything with the same prefix.
//
// dialogue.jsonl keeps every pre-island field verbatim (same shape, same
// X-Next-Since-Id cursor contract) and ADDS the island-era fields via a LEFT
// JOIN onto turn_meta — a turn from before the island era has no turn_meta
// row, so those fields come back `null`, which is the honest answer (spec §9).
// minds.json is unchanged from the old engine + one additive `island` block.
// world.jsonl / scenes.jsonl / island.json / metrics.json are NEW (spec §9).
// meta.json is rewritten: it now publishes the island era's eras, protocol,
// EVERY prompt template (rendered once against a sample world so a reader can
// see real text, not just a function name), model chains, the full NVIDIA
// registry and an architecture summary.
//
// Every route below states its own cache policy explicitly (src/cache.ts) —
// the global `seal()` middleware in src/index.ts only fills in `no-store` for
// a route that states nothing, so this file's DERIVED_JSON headers are what
// actually apply.
import { Hono } from 'hono';
import { CACHE, cacheHeaders } from '../cache';
import * as store from '../world/store';
import { ISLAND_AGENTS, KEVIN_CHAIN, JENNY_CHAIN, NARRATOR_CHAIN, CHAPTER_CHAIN } from '../world/models';
import { ERAS, TALKING_ERA_BASELINE, TOP_TALKING_ERA_PHRASES, BASELINE_UNIT_NOTE, BASELINE_SAMPLE_SIZE } from '../world/eras';
import {
  PROTOCOL, agentSystemPrompt, sceneOpening, planPrompt, NARRATOR_SYSTEM, transitionUserPrompt,
  morningUserPrompt, reflectionPrompt, CHAPTER_SYSTEM, chapterUserPrompt, makePrompt,
} from '../world/prompts';
import { initWorld } from '../world/sim';
import { BLISS_LEXICON, AGREE_OPENERS, METRIC_DEFINITIONS } from '../world/metrics';

type Bindings = { DB: D1Database; NVIDIA_API_KEY: string };

const exportsApp = new Hono<{ Bindings: Bindings }>();

const jsonlHeaders = (extra: Record<string, string>) => ({
  'Content-Type': 'application/x-ndjson; charset=utf-8',
  ...cacheHeaders(CACHE.DERIVED_JSON),
  ...extra,
});

// Model id lives on the first thoughts line: "🔧 Kevin · <model id> · ~N tok · island"
// (island era) or the older "🧠 Kevin · meta/llama-4-... · ~N tok · src" shape.
// Turns from before the model era (2026-06-12) have no model marker → null.
function modelFromThoughts(thoughts: string | null): string | null {
  const m = /·\s*([\w./:-]+)\s*·\s*~\d+\s*tok/.exec(thoughts || '');
  return m ? m[1] : null;
}

// ── /dialogue.jsonl ──────────────────────────────────────────────────────────

exportsApp.get('/dialogue.jsonl', async (c) => {
  const sinceId = parseInt(c.req.query('since_id') || '0') || 0;
  const limit = Math.min(500, Math.max(1, parseInt(c.req.query('limit') || '500') || 500));

  const rows = await c.env.DB.prepare(
    `SELECT dt.id as id, dt.turn_number as turn_number, dt.speaker as speaker, dt.content as content,
            dt.thoughts as thoughts, dt.related_packet_ids as related_packet_ids,
            dt.trigger_source as trigger_source, dt.turn_group as turn_group, dt.created_at as created_at,
            tm.era as era, tm.protocol as protocol, tm.scene_id as scene_id, tm.sim_day as sim_day,
            tm.sim_slot as sim_slot, tm.location as location, tm.thought as thought, tm.action as action,
            tm.retries as retries, tm.retry_reason as retry_reason, tm.notebook_refs as notebook_refs,
            tm.activity as activity, sc.mode as scene_mode
     FROM dialogue_turns dt LEFT JOIN turn_meta tm ON tm.turn_id = dt.id
     LEFT JOIN scenes sc ON sc.id = tm.scene_id
     WHERE dt.id > ? ORDER BY dt.id ASC LIMIT ?`
  ).bind(sinceId, limit).all<any>();
  const turns = rows.results || [];

  const lines = turns.map((t: any) => JSON.stringify({
    id: t.id,
    turn_number: t.turn_number,
    speaker: t.speaker,
    model: modelFromThoughts(t.thoughts),
    content: t.content,
    thoughts: t.thoughts,
    context_memory_refs: t.related_packet_ids, // JSON array; "mem:<id>" = agent_memories row in context
    trigger_source: t.trigger_source,
    conversation: t.turn_group,
    created_at: t.created_at,
    // Island-era additions (spec §9). null for a turn spoken before the island
    // era, which has no turn_meta row — that's the honest answer, not a bug.
    era: t.era ?? null,
    protocol: t.protocol ?? null,
    scene: t.scene_id ?? null,
    sim_day: t.sim_day ?? null,
    sim_slot: t.sim_slot ?? null,
    location: t.location ?? null,
    thought: t.thought ?? null,
    action: t.action ?? null,
    retries: t.retries ?? null,
    retry_reason: t.retry_reason ?? null,
    notebook_refs: t.notebook_refs ?? null,
    // Part 2 additions: what the speaker was visibly doing, and whether the
    // scene this turn belongs to was together or apart. Same null-for-pre-
    // island-turn honesty as everything else in this row.
    activity: t.activity ?? null,
    scene_mode: t.scene_mode ?? null,
  }));

  const lastId = turns.length > 0 ? turns[turns.length - 1].id : sinceId;
  return c.text(lines.join('\n'), 200, jsonlHeaders({
    'X-Next-Since-Id': String(lastId),
    'X-Returned': String(turns.length),
  }));
});

// ── /minds.json ──────────────────────────────────────────────────────────────

exportsApp.get('/minds.json', async (c) => {
  const mind = await import('../core/mind');
  const [journalKevin, journalJenny, memories, histKevin, histJenny, world] = await Promise.all([
    mind.getJournal(c.env.DB, 'kevin'),
    mind.getJournal(c.env.DB, 'jenny'),
    mind.listMemories(c.env.DB, 1000),
    mind.getJournalHistory(c.env.DB, 'kevin', 50),
    mind.getJournalHistory(c.env.DB, 'jenny', 50),
    store.loadWorld(c.env.DB),
  ]);
  const reflections = await c.env.DB.prepare(
    "SELECT agent, detail, created_at FROM agent_log WHERE action = 'reflect' ORDER BY id DESC LIMIT 200"
  ).all<any>().catch(() => ({ results: [] as any[] }));

  return c.json({
    journals: { kevin: journalKevin, jenny: journalJenny },
    // The edit history of each journal — the direct, readable record of them growing.
    journal_history: { kevin: histKevin, jenny: histJenny },
    memories,
    reflection_log: reflections.results || [],
    // Additive: their current standing intentions, if the island era has
    // started. null (not an empty object) when it hasn't — an absent world is
    // a real state here, not "no data yet".
    island: world ? {
      day: world.day, slot: world.slot,
      kevin: { plan: world.agents.kevin.plan, want: world.agents.kevin.want },
      jenny: { plan: world.agents.jenny.plan, want: world.agents.jenny.want },
    } : null,
    exported_at: new Date().toISOString(),
  }, 200, cacheHeaders(CACHE.DERIVED_JSON));
});

// ── /world.jsonl — world_events, cursor-paged like dialogue.jsonl ──────────────

exportsApp.get('/world.jsonl', async (c) => {
  await store.ensureIslandSchema(c.env.DB);
  const sinceId = parseInt(c.req.query('since_id') || '0') || 0;
  const limit = Math.min(500, Math.max(1, parseInt(c.req.query('limit') || '500') || 500));

  const rows = await c.env.DB.prepare(
    `SELECT * FROM world_events WHERE id > ? ORDER BY id ASC LIMIT ?`
  ).bind(sinceId, limit).all<any>();
  const events = rows.results || [];

  const lines = events.map((e: any) => JSON.stringify({
    id: e.id,
    day: e.day,
    slot: e.slot,
    kind: e.kind,
    who: e.who,
    detail: e.detail,
    data: e.data_json ? JSON.parse(e.data_json) : null,
    scene: e.scene_id,
    created_at: e.created_at,
  }));

  const lastId = events.length > 0 ? events[events.length - 1].id : sinceId;
  return c.text(lines.join('\n'), 200, jsonlHeaders({
    'X-Next-Since-Id': String(lastId),
    'X-Returned': String(events.length),
  }));
});

// ── /scenes.jsonl — scenes, cursor-paged on rowid (id is a lexical-not-
//    chronological string, see store.ts's getScenesForDay comment) ────────────

exportsApp.get('/scenes.jsonl', async (c) => {
  await store.ensureIslandSchema(c.env.DB);
  const since = parseInt(c.req.query('since') || '0') || 0;
  const limit = Math.min(500, Math.max(1, parseInt(c.req.query('limit') || '500') || 500));

  const rows = await c.env.DB.prepare(
    `SELECT rowid as _cursor, id, day, slot, location, title, setup, event, status, summary,
            outcomes_json, turn_count, model, opened_at, closed_at, mode, apart_json
     FROM scenes WHERE rowid > ? ORDER BY rowid ASC LIMIT ?`
  ).bind(since, limit).all<any>();
  const scenes = rows.results || [];

  const lines = scenes.map((s: any) => JSON.stringify({
    id: s.id,
    day: s.day,
    slot: s.slot,
    location: s.location,
    title: s.title,
    setup: s.setup,
    event: s.event,
    status: s.status,
    summary: s.summary,
    outcomes: s.outcomes_json ? JSON.parse(s.outcomes_json) : null,
    turn_count: s.turn_count,
    model: s.model,
    opened_at: s.opened_at,
    closed_at: s.closed_at,
    // Part 2 additions: 'together' or 'apart', and (only for 'apart') each
    // agent's own place/doing/setup for that stretch of the day.
    mode: s.mode || 'together',
    apart: s.apart_json ? JSON.parse(s.apart_json) : null,
  }));

  const lastCursor = scenes.length > 0 ? scenes[scenes.length - 1]._cursor : since;
  return c.text(lines.join('\n'), 200, jsonlHeaders({
    'X-Next-Since': String(lastCursor),
    'X-Returned': String(scenes.length),
  }));
});

// ── /island.json — the current world, minus its hidden fields ────────────────

exportsApp.get('/island.json', async (c) => {
  await store.ensureIslandSchema(c.env.DB);
  const world = await store.loadWorld(c.env.DB);
  if (!world) {
    return c.json({ started: false, note: 'The island era has not begun on this deployment yet.' }, 200, cacheHeaders(CACHE.DERIVED_JSON));
  }

  const [notebook, artifacts, chapters, kevinRecord, jennyRecord] = await Promise.all([
    store.listNotebook(c.env.DB, 200, 0),
    store.listArtifacts(c.env.DB, 100, 0),
    store.listChapters(c.env.DB, 60, 0),
    store.forecastRecord(c.env.DB, 'kevin', 60),
    store.forecastRecord(c.env.DB, 'jenny', 60),
  ]);

  // The world document verbatim, EXCEPT `hidden` (barometer pressure/trend) —
  // that field exists so the narrator can reason about weather a slot or two
  // ahead; publishing it would hand out the answer to the one thing the
  // agents' own forecasts are supposed to be learning (spec §3, §9).
  const { hidden, ...worldWithoutHidden } = world;

  return c.json({
    world: worldWithoutHidden,
    projects: world.projects,
    notebook,
    // Artifact CONTENT lives at /made/:id and in listArtifacts already trimmed
    // to metadata by store.listArtifacts — no extra stripping needed here.
    artifacts: artifacts.map((a) => ({
      id: a.id, day: a.day, maker: a.maker, kind: a.kind, title: a.title,
      format: a.format, scene_id: a.scene_id, model: a.model, created_at: a.created_at,
    })),
    chapters: chapters.map((ch) => ({ day: ch.day, title: ch.title, model: ch.model, created_at: ch.created_at })),
    forecasts: { kevin: kevinRecord, jenny: jennyRecord },
    exported_at: new Date().toISOString(),
  }, 200, cacheHeaders(CACHE.DERIVED_JSON));
});

// ── /metrics.json — the daily roll-up + the talking-era baseline + defs ──────

exportsApp.get('/metrics.json', async (c) => {
  await store.ensureIslandSchema(c.env.DB);
  const days = await store.listDayMetrics(c.env.DB, 200);

  return c.json({
    island_daily: days.map((d) => ({ day: d.day, metrics: JSON.parse(d.json), created_at: d.created_at })),
    talking_era_baseline: TALKING_ERA_BASELINE,
    baseline_unit_note: BASELINE_UNIT_NOTE,
    baseline_sample_size: BASELINE_SAMPLE_SIZE,
    top_talking_era_phrases: TOP_TALKING_ERA_PHRASES,
    lexicons: { bliss: BLISS_LEXICON, agree_openers: AGREE_OPENERS },
    definitions: METRIC_DEFINITIONS,
    exported_at: new Date().toISOString(),
  }, 200, cacheHeaders(CACHE.DERIVED_JSON));
});

// ── /meta.json — eras, protocol, every prompt template, chains, registry ─────
//
// The prompt templates are rendered once against a SAMPLE world (sim.initWorld
// at a fixed instant) and placeholder journal/memory/notebook text, so a
// reader sees real, complete text — not a description of a function. This is
// not live data: no D1 row backs it, and the values in parentheses below are
// exactly that, placeholders, the same way spec §9 asks for "rendered with
// placeholders".

function samplePromptSet() {
  const w = initWorld('2026-09-25T06:00:00Z');
  const setup = 'They are on the veranda as the light comes up, the kettle going on the stove behind them.';

  const agentCtx = {
    world: w,
    agent: 'kevin' as const,
    journal: '(their journal so far, in their own words)',
    memories: ['(a specific thing from an earlier day that came to mind)'],
    notebook: ['(a fact or lesson the two of them have learned on the island)'],
    earlierToday: ['(a one-line summary of an earlier scene today)'],
    setup,
  };

  return {
    agent_system: {
      description: 'System prompt sent to whichever agent is about to speak. Rendered fresh every turn from live world state (weather, resources, journal, memories, scene) — this is one sample render, not a static template string.',
      builder: 'src/world/prompts.ts#agentSystemPrompt',
      sample: agentSystemPrompt(agentCtx),
    },
    scene_opening: {
      description: 'The first user message of a scene: the narrator\'s present-tense setup, plus a visitor bottle\'s text when one is being read in this scene.',
      builder: 'src/world/prompts.ts#sceneOpening',
      sample: sceneOpening(setup),
    },
    plan: {
      description: 'One call per agent at dawn: their private intentions for the day, an honest feeling, and a weather forecast (scored against the actual weather the next dawn — src/world/store.ts#scoreForecasts).',
      builder: 'src/world/prompts.ts#planPrompt',
      sample: planPrompt({ world: w, agent: 'jenny', journal: '(their journal so far)', yesterday: '(what happened yesterday, summarized)' }),
    },
    narrator_system: {
      description: 'System prompt for every narrator call (transition, morning setup). The narrator is never Kevin or Jenny and never writes their words.',
      builder: 'src/world/prompts.ts#NARRATOR_SYSTEM',
      sample: NARRATOR_SYSTEM,
    },
    transition: {
      description: 'One call per scene boundary: given the transcript, dice rolls, a possible world event and the plans each agent made, the narrator decides what happened and clamps to a strict JSON shape — every number it proposes is then clamped again in code (src/world/sim.ts#clampTransition) before it touches the world.',
      builder: 'src/world/prompts.ts#transitionUserPrompt',
      sample: transitionUserPrompt({
        world: w,
        transcript: 'Kevin: "The tank\'s low again." (Kevin checks the rain gauge)\nJenny: "We should move the seedlings before the wind gets up."',
        rolls: { kevin: 14, jenny: 9 },
        nextSlot: 'morning',
        nextDay: w.day,
        event: '(a world event seed, e.g. "driftwood and a crate wash up on the south beach")',
        radio: null,
        plans: { kevin: '(what Kevin said he meant to do today)', jenny: '(what Jenny said she meant to do today)' },
        hiddenPlaces: '(places not yet discovered, if any)',
        notebook: ['(an established fact the narrator must keep continuity with)'],
      }),
    },
    morning_setup: {
      description: 'The one call that opens the very first scene of a day, when no transition preceded it.',
      builder: 'src/world/prompts.ts#morningUserPrompt',
      sample: morningUserPrompt(w, '(what happened yesterday, summarized)', '(a morning world event, if any)'),
    },
    reflection: {
      description: 'One call per agent at night: a private, never-shown-to-the-other rewrite of their journal, up to 3 new memories, up to 2 practical lessons for the shared notebook, and their want for tomorrow.',
      builder: 'src/world/prompts.ts#reflectionPrompt',
      sample: reflectionPrompt({ world: w, agent: 'kevin', journal: '(their journal so far)', today: '(what actually happened today, summarized from the day\'s scenes)' }),
    },
    chapter_system: {
      description: 'System prompt for the once-a-day chapter. Quotes are checked mechanically against the day\'s actual SAY lines before publishing (src/world/narrator.ts#chapter) — an unverifiable quote is dropped, never invented.',
      builder: 'src/world/prompts.ts#CHAPTER_SYSTEM',
      sample: CHAPTER_SYSTEM,
    },
    chapter: {
      description: 'The user message for that one daily call.',
      builder: 'src/world/prompts.ts#chapterUserPrompt',
      sample: chapterUserPrompt(w.day, '(the day\'s scenes, SAY lines, events and artifacts made)'),
    },
    make: {
      description: 'When an agent\'s DO reads as "make <kind>: <title>", one call produces the artifact itself — either raw SVG (sanitised in code, src/world/svg.ts#sanitizeSvg, before it is ever stored or served) for a visual kind, or plain text for anything else.',
      builder: 'src/world/prompts.ts#makePrompt',
      sample: makePrompt({ agent: 'jenny', kind: 'sketch', title: 'the reef at low tide', world: w, context: '(what led to making it, one line)' }),
    },
  };
}

exportsApp.get('/meta.json', async (c) => {
  const { NVIDIA_MODELS, NVIDIA_BASE_URL, REGISTRY_VERIFIED_ON, FREE_TIER_RPM } = await import('../core/nvidia');
  const packetOps = await import('../db/packet');
  const dialogueOps = await import('../db/dialogue');
  const mind = await import('../core/mind');
  await store.ensureIslandSchema(c.env.DB);
  const [state, dialogueCount, memories, world, scenesCount, notebookCount, artifactsCount] = await Promise.all([
    packetOps.getSystemState(c.env.DB),
    dialogueOps.getDialogueTurnCount(c.env.DB),
    mind.listMemories(c.env.DB, 1),
    store.loadWorld(c.env.DB),
    store.countScenes(c.env.DB),
    store.countNotebook(c.env.DB),
    store.countArtifacts(c.env.DB),
  ]);

  return c.json({
    experiment: 'Living Core — two AI agents (a married couple) living continuously in public, protocol island-1',
    site: 'https://livingcore.cc',
    source: 'https://github.com/lumorabuild/livingcore',
    docs: 'https://github.com/lumorabuild/livingcore/blob/main/DATA.md',
    license: { code: 'MIT', data: 'CC0-1.0' },
    born_at: state.born_at || null,
    island_started_at: world ? (await store.getIslandStartedAt(c.env.DB)) : null,
    protocol: PROTOCOL,
    counts: {
      dialogue_turns: dialogueCount,
      latest_memory_id: memories[0]?.id || 0,
      island_scenes: scenesCount,
      notebook_entries: notebookCount,
      artifacts_made: artifactsCount,
      island_day: world?.day ?? null,
    },
    eras: ERAS,
    agents: {
      kevin: { chain: KEVIN_CHAIN.map((m) => m.id) },
      jenny: { chain: JENNY_CHAIN.map((m) => m.id) },
    },
    chains: {
      kevin: KEVIN_CHAIN.map((m) => m.id),
      jenny: JENNY_CHAIN.map((m) => m.id),
      narrator: NARRATOR_CHAIN.map((m) => m.id),
      chapter: CHAPTER_CHAIN.map((m) => m.id),
    },
    prompts: samplePromptSet(),
    inference: {
      provider: NVIDIA_BASE_URL,
      // Every model runs on NVIDIA's free developer tier — no paid provider, no
      // per-token billing, no card on the account. The only ceiling is rate.
      tier: 'nvidia-free',
      free_tier_rpm: FREE_TIER_RPM,
      registry: NVIDIA_MODELS,
      registry_verified_on: REGISTRY_VERIFIED_ON,
      dead_model_memory: 'a model that answers 404/410 is skipped for 12h per src/world/store.ts#getGoneModels/markGone — never treated as permanently gone, and never allowed to silence a whole chain if every model in it is currently marked gone',
    },
    architecture: [
      'the world is deterministic code (src/world/sim.ts): clock, weather, tides, resources, fatigue, dice — never a model',
      'a cron tick (src/world/tick.ts) plays up to 2 scene turns per call when the scene is TOGETHER, but only 1 when it is APART (the owner wants the island calmer while they are apart — the page animates the time in between), or runs one job (opening/closing a scene, a plan, reflection, the chapter, making something) — budgeted to 6 real model-call ATTEMPTS (every retry through a chain counts, not just the logical turn/job) / 85s wall time, guarded by a fenced D1 tick lock (a token, not a bare boolean, so a tick that outlives its own TTL can never release a LATER tick\'s lock) so two overlapping ticks never both run',
      'each turn is a real completion through one of four model chains (src/world/models.ts), never a template',
      'a narrator model (never Kevin or Jenny) adjudicates what happens between scenes and clamps its own numbers through code (src/world/sim.ts#clampTransition) before anything is applied',
      'agents can save permanent memories inline with [remember: ...] tags, and privately reflect at the end of each day (journal + memories + a shared notebook + a private want)',
      'a model that answers 404/410 is remembered as gone for 12h (src/world/store.ts#markGone) so a dead model never silently eats a whole chain\'s retry budget',
      'no scripted fallback voice exists: every posted turn is a real completion, and if every model in a chain is unreachable, nothing is posted that turn',
      'a daily chapter is written once a day and mechanically quote-checked against that day\'s actual SAY lines before publishing — an unverifiable quote is dropped, never invented',
      'weather has a hidden driver (barometric pressure) the agents can read (barometerLine) but are never told the rule for — their own next-day forecasts are scored against the real outcome, which is the one measured learning curve /lab charts',
    ],
    exports: {
      dialogue: '/api/export/dialogue.jsonl?since_id=0&limit=500 (paginate via X-Next-Since-Id until empty)',
      minds: '/api/export/minds.json',
      world_events: '/api/export/world.jsonl?since_id=0&limit=500 (paginate via X-Next-Since-Id until empty)',
      scenes: '/api/export/scenes.jsonl?since=0&limit=500 (paginate via X-Next-Since until empty)',
      island: '/api/export/island.json',
      metrics: '/api/export/metrics.json',
      meta: '/api/export/meta.json',
    },
  }, 200, cacheHeaders(CACHE.DERIVED_JSON));
});

export default exportsApp;
