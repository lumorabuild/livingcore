// ─────────────────────────────────────────────────────────────────────────────
// THE ERAS — the honest timeline /lab and /api/export/meta.json tell.
//
// The island era exists BECAUSE of what's in TALKING_ERA_BASELINE below: two
// assistant-tuned models given a body-less "you are a married couple" prompt
// converged on agreeable warmth, and once Kevin silently fell back to Jenny's
// model (2026-07-30) that convergence became literal — one voice, not two.
// distinct2 fell 0.39 → 0.21 and bliss_rate rose 0.28 → 0.93 in two weeks.
// See src/world/bio.ts's header and src/world/models.ts's chain comment for
// what the island era does differently (four separate model chains, a body,
// chores, and consequences neither agent controls).
// ─────────────────────────────────────────────────────────────────────────────

export interface Era {
  id: string;
  name: string;
  /** ISO date the era began, or null when it's read at runtime (see the island entry). */
  from: string | null;
  /** ISO date the era ended, or null when it's still current. */
  to: string | null;
  summary: string;
  models: string;
}

export const ERAS: Era[] = [
  {
    id: 'template',
    name: 'Template era',
    from: '2026-06-04',
    to: '2026-06-12',
    summary: 'Scripted, symbolic voice — no model calls at all. A control group, not a conversation.',
    models: 'none (templated)',
  },
  {
    id: 'talking-1',
    name: 'Talking era I',
    from: '2026-06-12',
    to: '2026-07-15',
    summary: 'The first real model era, and the healthiest stretch on every collapse metric below — two genuinely distinct voices.',
    models: 'Kevin: meta/llama-4-maverick-17b-128e-instruct · Jenny: mistralai/ministral-14b-instruct-2512',
  },
  {
    id: 'gap',
    name: 'Gap',
    from: '2026-07-15',
    to: '2026-07-17',
    summary: 'Both talking-era-I models were retired by NVIDIA within a day of each other. No turns.',
    models: 'none — both dead',
  },
  {
    id: 'talking-2',
    name: 'Talking era II',
    from: '2026-07-17',
    to: '2026-08-26',
    summary:
      "A new pair, then a collapse: from 2026-07-30 Kevin silently fell back to Jenny's own model, so both agents " +
      'ran the SAME model. bliss_rate rose from ~0.28 to ~0.93 and distinct2 fell from ~0.39 to ~0.21 within two ' +
      "weeks (TALKING_ERA_BASELINE below). This monoculture is exactly what the island era's four separate model " +
      'chains (src/world/models.ts) exist to make structurally impossible.',
    models:
      'to 2026-07-30: Kevin mistralai/mistral-small-4-119b-2603, Jenny meta/llama-3.1-8b-instruct — ' +
      'from 2026-07-30: BOTH on meta/llama-3.1-8b-instruct',
  },
  {
    id: 'silence',
    name: 'Silence',
    from: '2026-08-26',
    to: null,
    summary: 'Both talking-era-II models were retired. Nothing was produced until the island era shipped.',
    models: 'none — both dead',
  },
  {
    id: 'island',
    name: 'Island era',
    from: null,
    to: null,
    summary:
      'A body, a place, chores, weather, tides, skills, projects and real consequences — protocol island-1. ' +
      "`from` is read at runtime from system_state['island_started_at'] (src/world/store.ts's loadWorld/initWorld), " +
      'written once, the first time the world is created.',
    models: 'src/world/models.ts: KEVIN_CHAIN / JENNY_CHAIN (dialogue) · NARRATOR_CHAIN (adjudication) · CHAPTER_CHAIN (the daily chapter)',
  },
];

// ── The talking-era collapse, measured (2026-09-25, ~3,300-turn sample) ──

export interface TalkingEraWeek {
  /** ISO date of the week sampled. */
  week_of: string;
  distinct2: number;
  bliss: number;
  /** Consecutive-turn word overlap. Not measured for the 2026-07-09 sample. */
  overlap: number | null;
  avgChars: number;
  models: string;
}

export const TALKING_ERA_BASELINE: TalkingEraWeek[] = [
  { week_of: '2026-06-18', distinct2: 0.394, bliss: 0.283, overlap: 0.220, avgChars: 308, models: 'ministral-14b+llama-4-maverick' },
  { week_of: '2026-06-25', distinct2: 0.389, bliss: 0.283, overlap: 0.218, avgChars: 298, models: 'ministral-14b+llama-4-maverick' },
  { week_of: '2026-07-09', distinct2: 0.411, bliss: 0.400, overlap: null, avgChars: 315, models: 'ministral-14b' },
  { week_of: '2026-07-16', distinct2: 0.361, bliss: 0.527, overlap: 0.261, avgChars: 226, models: 'mistral-small-4+llama-3.1-8b' },
  { week_of: '2026-07-23', distinct2: 0.356, bliss: 0.457, overlap: 0.245, avgChars: 219, models: 'mistral-small-4+llama-3.1-8b' },
  { week_of: '2026-07-30', distinct2: 0.197, bliss: 0.920, overlap: 0.442, avgChars: 259, models: "llama-3.1-8b ONLY (Kevin silently on Jenny's model)" },
  { week_of: '2026-08-06', distinct2: 0.210, bliss: 0.930, overlap: 0.454, avgChars: 247, models: 'llama-3.1-8b only' },
  { week_of: '2026-08-13', distinct2: 0.229, bliss: 0.900, overlap: 0.430, avgChars: 240, models: 'llama-3.1-8b only' },
  { week_of: '2026-08-20', distinct2: 0.219, bliss: 0.847, overlap: 0.436, avgChars: 246, models: 'llama-3.1-8b only' },
];

/** Sample size the baseline above and TOP_TALKING_ERA_PHRASES were measured from. */
export const BASELINE_SAMPLE_SIZE = 3300;

/**
 * distinct2 in TALKING_ERA_BASELINE is per WEEK on a ~300-turn sample; island-
 * era distinct2 (src/world/metrics.ts's computeDayMetrics) is per DAY on that
 * day's full turn set. Same formula, different denominator — /lab must say
 * this, never just plot the two series as if they were the same unit.
 */
export const BASELINE_UNIT_NOTE =
  'distinct2 above is computed per WEEK on a ~300-turn sample of the talking-era archive; island-era distinct2 is ' +
  "computed per DAY on that day's full turn set. Same formula, different denominator — compare the shape of the " +
  'curve, not the raw numbers side by side.';

export const TOP_TALKING_ERA_PHRASES: { phrase: string; count: number; of: number; pct: number }[] = [
  { phrase: 'feeling a sense of', count: 762, of: BASELINE_SAMPLE_SIZE, pct: 762 / BASELINE_SAMPLE_SIZE },
  { phrase: 'my voice filled with', count: 481, of: BASELINE_SAMPLE_SIZE, pct: 481 / BASELINE_SAMPLE_SIZE },
  { phrase: 'voice barely above a whisper', count: 407, of: BASELINE_SAMPLE_SIZE, pct: 407 / BASELINE_SAMPLE_SIZE },
  { phrase: 'the world around us', count: 382, of: BASELINE_SAMPLE_SIZE, pct: 382 / BASELINE_SAMPLE_SIZE },
];
