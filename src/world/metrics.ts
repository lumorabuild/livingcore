// ─────────────────────────────────────────────────────────────────────────────
// METRICS — what "healthier than the talking era" actually MEANS, measured.
//
// The talking era's collapse (see src/world/eras.ts) is legible in exactly
// these numbers: distinct-2 collapsed 0.39 → 0.21, bliss_rate rose 0.28 →
// 0.93, both agents ended up on one model. Pure functions here compute the
// same shapes over island-era turns so the two eras are directly comparable
// on /lab — with one unit caveat documented on METRIC_DEFINITIONS.distinct2.
// ─────────────────────────────────────────────────────────────────────────────

import type { AgentId, World } from './types';
import { AGENT_IDS } from './types';
import { skillLevel } from './bio';
import { countNotebook, deriveSay, forecastRecord, loadWorld } from './store';

export const BLISS_LEXICON = [
  'heart is overflowing', 'so grateful', 'sense of', 'tapestry', 'soul', 'universe',
  'deeply connected', 'completely agree', 'so glad', 'filled with love', 'whisper', 'my love',
];

export const AGREE_OPENERS = [
  'yes', 'i agree', 'absolutely', 'exactly', "you're right", 'i love that', 'so true', 'totally',
];

export const METRIC_DEFINITIONS: Record<string, string> = {
  turns: 'Total turns spoken that day.',
  words_per_say: 'Mean word count of SAY across the day\'s turns.',
  distinct2: 'Unique word bigrams / total word bigrams across all SAYs that day — the talking-era collapse metric. The baseline table (eras.ts) computed this per WEEK on a ~300-turn sample; here it is per ISLAND DAY on all of that day\'s turns. The units differ — see the note on /lab before comparing them directly.',
  bliss_rate: 'Share of SAYs containing at least one phrase from BLISS_LEXICON.',
  agree_opener_rate: "Share of SAYs whose first ~6 words match an affirmation opener (yes, i agree, absolutely, you're right, …).",
  opener_repeat_rate: "Share of SAYs whose first-5-word opener already occurred earlier the same day.",
  consecutive_overlap: 'Mean word-Jaccard similarity of a SAY against the previous SAY in the same scene.',
  action_rate: 'Share of turns with a non-empty, non-"nothing" DO.',
  retry_rate: "Share of turns that needed the quality-gate retry (agent.ts's speak()).",
  thought_say_gap: '1 minus the mean word-Jaccard(THOUGHT, SAY) — how much of the private thought never makes it into speech.',
  silent_rate: 'Share of turns where SAY was empty (DO only).',
  models: 'Count of turns produced by each model id that day.',
  events: 'World events logged that day.',
  discoveries: "Discovery-kind events that day.",
  notebook_total: 'Total notebook entries ever recorded (not day-scoped).',
  artifacts_made: 'Artifacts made that day.',
  projects_done_total: "Projects with status=done, total to date (not day-scoped).",
  skill_total: 'Sum of skill levels (0-10 each, see bio.skillLevel) per agent, as of the end of the day.',
  forecast_accuracy: 'Rolling 7-day weather-forecast record per agent: {n, correct}.',
  water_at_night: "Litres in the rain tank at the end of the day (the night before the next dawn).",
  food_at_night: 'Days of food left in the pantry at the end of the day.',
};

export interface MetricTurn {
  say: string;
  thought: string;
  do: string;
  scene_id: string;
  speaker: AgentId;
  model: string;
  retries: number;
}

function normWords(text: string): string[] {
  return (text || '').toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter(Boolean);
}

function bigrams(words: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length - 1; i++) out.push(`${words[i]} ${words[i + 1]}`);
  return out;
}

function jaccardWords(a: string, b: string): number {
  const wa = new Set(normWords(a));
  const wb = new Set(normWords(b));
  if (wa.size === 0 && wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : inter / union;
}

/** Total occurrences of any BLISS_LEXICON phrase in `text` (a repeated phrase counts each time). */
export function blissHits(text: string): number {
  const lower = (text || '').toLowerCase();
  let hits = 0;
  for (const phrase of BLISS_LEXICON) {
    let idx = 0;
    for (;;) {
      const found = lower.indexOf(phrase, idx);
      if (found < 0) break;
      hits++;
      idx = found + phrase.length;
    }
  }
  return hits;
}

function isAgreeOpener(say: string): boolean {
  const opener = normWords(say).slice(0, 6).join(' ');
  return AGREE_OPENERS.some((o) => opener.startsWith(o));
}

function opener5(say: string): string {
  return normWords(say).slice(0, 5).join(' ');
}

export interface TurnMetrics {
  turns: number;
  words_per_say: number;
  distinct2: number;
  bliss_rate: number;
  agree_opener_rate: number;
  opener_repeat_rate: number;
  consecutive_overlap: number;
  action_rate: number;
  retry_rate: number;
  thought_say_gap: number;
  silent_rate: number;
  models: Record<string, number>;
}

const EMPTY_TURN_METRICS: TurnMetrics = {
  turns: 0, words_per_say: 0, distinct2: 0, bliss_rate: 0, agree_opener_rate: 0, opener_repeat_rate: 0,
  consecutive_overlap: 0, action_rate: 0, retry_rate: 0, thought_say_gap: 0, silent_rate: 0, models: {},
};

/** Pure — everything the day's turns themselves can tell you, with no DB reads. */
export function computeTurnMetrics(turns: MetricTurn[]): TurnMetrics {
  const n = turns.length;
  if (n === 0) return { ...EMPTY_TURN_METRICS };

  let wordTotal = 0;
  const allBigrams: string[] = [];
  let blissCount = 0;
  let agreeCount = 0;
  let openerRepeatCount = 0;
  let overlapSum = 0;
  let overlapCount = 0;
  let actionCount = 0;
  let retryCount = 0;
  let gapSum = 0;
  let silentCount = 0;
  const models: Record<string, number> = {};
  const seenOpeners = new Set<string>();
  const lastSayByScene: Record<string, string> = {};

  for (const t of turns) {
    const words = normWords(t.say);
    wordTotal += words.length;
    allBigrams.push(...bigrams(words));
    if (blissHits(t.say) >= 1) blissCount++;
    if (isAgreeOpener(t.say)) agreeCount++;

    const opener = opener5(t.say);
    if (opener) {
      if (seenOpeners.has(opener)) openerRepeatCount++;
      seenOpeners.add(opener);
    }

    const prevSay = lastSayByScene[t.scene_id];
    if (prevSay !== undefined) {
      overlapSum += jaccardWords(t.say, prevSay);
      overlapCount++;
    }
    lastSayByScene[t.scene_id] = t.say;

    const doText = t.do.trim().toLowerCase();
    if (doText && doText !== 'nothing') actionCount++;
    if (t.retries > 0) retryCount++;
    gapSum += jaccardWords(t.thought, t.say);
    if (!t.say.trim()) silentCount++;
    models[t.model] = (models[t.model] || 0) + 1;
  }

  const uniqueBigrams = new Set(allBigrams).size;

  return {
    turns: n,
    words_per_say: wordTotal / n,
    distinct2: allBigrams.length ? uniqueBigrams / allBigrams.length : 0,
    bliss_rate: blissCount / n,
    agree_opener_rate: agreeCount / n,
    opener_repeat_rate: openerRepeatCount / n,
    consecutive_overlap: overlapCount ? overlapSum / overlapCount : 0,
    action_rate: actionCount / n,
    retry_rate: retryCount / n,
    thought_say_gap: 1 - gapSum / n,
    silent_rate: silentCount / n,
    models,
  };
}

export interface DayMetrics extends TurnMetrics {
  day: number;
  events: number;
  discoveries: number;
  notebook_total: number;
  artifacts_made: number;
  projects_done_total: number;
  skill_total: Record<AgentId, number>;
  forecast_accuracy: Record<AgentId, { n: number; correct: number }>;
  water_at_night: number | null;
  food_at_night: number | null;
}

/**
 * Reads that day's island turns (bounded, indexed on sim_day) plus small
 * counts and the current world doc, and returns the full daily roll-up —
 * called once, from the chapter job, and stored (store.putDayMetrics /
 * chapters.stats_json) rather than recomputed on every page view.
 */
export async function computeDayMetrics(db: D1Database, day: number): Promise<DayMetrics> {
  const rows = await db.prepare(
    `SELECT dt.speaker as speaker, dt.content as content, tm.thought as thought, tm.action as action,
            tm.scene_id as scene_id, tm.model as model, tm.retries as retries
     FROM turn_meta tm JOIN dialogue_turns dt ON dt.id = tm.turn_id
     WHERE tm.sim_day = ? AND tm.era = 'island'
     ORDER BY dt.id ASC LIMIT 500`
  ).bind(day).all<any>();

  const turns: MetricTurn[] = (rows.results || []).map((r: any) => ({
    say: deriveSay(r.content, r.action || ''),
    thought: r.thought || '',
    do: r.action || '',
    scene_id: r.scene_id,
    speaker: r.speaker,
    model: r.model,
    retries: r.retries || 0,
  }));

  const base = computeTurnMetrics(turns);

  const [eventsRow, discoveriesRow, notebookTotal, artifactsRow, world, kevinForecast, jennyForecast] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as n FROM world_events WHERE day = ?`).bind(day).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) as n FROM world_events WHERE day = ? AND kind = 'discovery'`).bind(day).first<{ n: number }>(),
    countNotebook(db),
    db.prepare(`SELECT COUNT(*) as n FROM artifacts WHERE day = ?`).bind(day).first<{ n: number }>(),
    loadWorld(db) as Promise<World | null>,
    forecastRecord(db, 'kevin', 7),
    forecastRecord(db, 'jenny', 7),
  ]);

  const projects_done_total = world ? world.projects.filter((p) => p.status === 'done').length : 0;
  const skill_total = { kevin: 0, jenny: 0 } as Record<AgentId, number>;
  if (world) {
    // Prefer the snapshot taken the moment `day`'s night scene closed
    // (world.last_night_xp — tick.ts's runCloseSceneJob) over the WORLD'S
    // CURRENT live xp: this function is called from writeChapter, whose job
    // can retry across ticks, and by the time it finally succeeds the world
    // may already be a day or more ahead — loadWorld() here would then
    // silently attribute a LATER day's skill growth to this one.
    for (const id of AGENT_IDS) {
      const xp = world.last_night_xp?.[id] ?? world.agents[id].xp;
      skill_total[id] = Object.values(xp).reduce((sum, x) => sum + skillLevel(x), 0);
    }
  }

  return {
    ...base,
    day,
    events: eventsRow?.n ?? 0,
    discoveries: discoveriesRow?.n ?? 0,
    notebook_total: notebookTotal,
    artifacts_made: artifactsRow?.n ?? 0,
    projects_done_total,
    skill_total,
    forecast_accuracy: { kevin: kevinForecast, jenny: jennyForecast },
    water_at_night: world?.resources.water_l ?? null,
    food_at_night: world?.resources.food_days ?? null,
  };
}
