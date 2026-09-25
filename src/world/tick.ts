// ─────────────────────────────────────────────────────────────────────────────
// THE TICK — one cron/​__cron invocation, budgeted (spec §6).
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Activity, AgentId, AgentState, Health, LocationId, Project, QueuedJob, Season, SceneState, Slot, Weather, World,
} from './types';
import { AGENT_IDS } from './types';
import { barometerLine, tide, initWorld, advanceSlot, newDay, applyTransition } from './sim';
import { activityFromDo } from './activity';
import { BIOGRAPHIES, LOCATIONS } from './bio';
import { PROTOCOL } from './prompts';
import {
  acquireTickLock, addNotebook, closeScene, ensureIslandSchema, getBottle, getChapter, getDailyUsage,
  getGoneModels, getInboxNote, getScenesForDay, getSceneTurns, insertScene, insertTurn, loadWorld, logEvent,
  logEvents, markGone, nowIso, releaseTickLock, saveWorld, setBottle, setIslandStartedAt, setRadioCache,
  getRadioCache, setSystemState,
} from './store';
import type { SceneTurnRow } from './store';
import { speak, planDay, reflect } from './agent';
import { transition, morningSetup, writeChapter, makeArtifact } from './narrator';
import { updateInboxStatus } from '../db/dialogue';
import { setCallDeadline } from '../core/nvidia';

export interface IslandEnv {
  DB: D1Database;
  NVIDIA_API_KEY?: string;
}

export interface TickResult {
  outcome: string;
  calls: number;
  turns: number;
  day: number;
  slot: Slot;
  scene: string | null;
}

// ── Budget (spec §6) ──

/**
 * REAL HTTP attempts, not logical jobs/turns — every job runner and speak()
 * now sums nvidiaChatChain's own `attempts` (it may fall through several
 * dead/overloaded models before landing one), so this is the tick's true
 * request budget. Originally 4, calibrated back when each job/turn was
 * undercounted as exactly 1 request regardless of how many models a chain
 * actually had to try; raised to 6 for the same real work now that the count
 * is honest (adversarial review + a 3-day simulation run, part 2 follow-up).
 */
const MAX_CALLS_PER_TICK = 6;
const MAX_TURNS_PER_TICK = 2;
/** Apart scenes get ONE turn a tick, never two — the owner wants the island calmer, and the page animates the time in between (part 2 spec §A). */
const MAX_TURNS_PER_TICK_APART = 1;
const TICK_WALL_BUDGET_MS = 85_000;
const TICK_LOCK_TTL_MS = 115_000;
/** Every model call must be finished by then (see setCallDeadline in core/nvidia.ts) — well inside the lock TTL. */
const TICK_CALL_DEADLINE_MS = 100_000;
/** A model-calling job never starts with less than this left before the call deadline (see the job loop). */
const MIN_JOB_WINDOW_MS = 55_000;
const DAILY_TOKEN_BUDGET = 12_000_000;
const DAILY_CALL_BUDGET = 4000;
const MAKE_QUOTA_PER_DAY = 6;

const TARGET_TURN_RANGES: Record<Slot, [number, number]> = {
  // Spec's table only names morning/midday/afternoon/evening/night; dawn is
  // the daily "waking up" scene (day 1's first scene, and every post-night
  // scene once advanceSlot cycles night -> dawn), so it gets morning's range.
  dawn: [6, 10], morning: [6, 10], midday: [6, 10], afternoon: [8, 12], evening: [8, 14], night: [4, 8],
};

function targetTurnsFor(slot: Slot): number {
  const [lo, hi] = TARGET_TURN_RANGES[slot];
  const evenLo = lo % 2 === 0 ? lo : lo + 1;
  const evenHi = hi % 2 === 0 ? hi : hi - 1;
  const span = Math.floor((evenHi - evenLo) / 2) + 1;
  return evenLo + 2 * Math.floor(Math.random() * span);
}

/** An apart scene's target is 4 or 6 turns total — 2-3 each (part 2 spec §A). */
function apartTargetTurns(): number {
  return Math.random() < 0.5 ? 4 : 6;
}

// ── Job runners — each returns {ok, calls}. They never touch w.jobs[0]
// themselves (the main loop shifts/retries it); they only PUSH follow-up
// jobs where the algorithm calls for it. ──

interface JobOutcome { ok: boolean; calls: number }

function sumCalls(callsOut: number[]): number {
  return callsOut.reduce((a, b) => a + b, 0);
}

async function runPlanJob(
  env: IslandEnv, db: D1Database, w: World, agent: AgentId, gone: Set<string>, goneOut: string[]
): Promise<JobOutcome> {
  const callsOut: number[] = [];
  const ok = await planDay(env, db, w, agent, gone, goneOut, callsOut);
  return { ok, calls: sumCalls(callsOut) };
}

async function runNewDayJob(db: D1Database, w: World): Promise<JobOutcome> {
  const seeds = await newDay(db, w);
  if (seeds.length) {
    await logEvents(db, seeds.map((s) => ({
      day: w.day, slot: w.slot, kind: s.kind, who: s.who || 'world', detail: s.detail,
      data_json: s.data_json ?? null, scene_id: null,
    })));
  }
  return { ok: true, calls: 0 };
}

/** True (case-insensitive) if the morning's setup text mentions breakfast — the one text signal we have, from the narrator's own words, for "they've woken up and are eating" (part 2 spec §A). */
const BREAKFAST_RE = /\bbreakfast\b/i;

async function runOpenSceneJob(
  env: IslandEnv, db: D1Database, w: World, gone: Set<string>, goneOut: string[]
): Promise<JobOutcome> {
  let next = w.next;
  const callsOut: number[] = [];

  if (!next) {
    let yesterday = '';
    if (w.day > 1) {
      const chapter = await getChapter(db, w.day - 1);
      if (chapter?.body) yesterday = chapter.body.slice(0, 800);
    }
    next = await morningSetup(env, db, w, yesterday, gone, goneOut, callsOut);
    if (!next) return { ok: false, calls: sumCalls(callsOut) };
    // The night scene that closed before this set both of them 'sleeping'
    // (runCloseSceneJob below); this is the moment they wake, so it's the
    // moment that activity changes to something else.
    const wakeActivity: Activity = BREAKFAST_RE.test(next.setup) ? 'eating' : 'idle';
    w.agents.kevin.activity = wakeActivity;
    w.agents.jenny.activity = wakeActivity;
  }

  // together defaults true (NextScene.together is optional — see types.ts):
  // this covers morningSetup's replies (which never set it) and any `next`
  // saved before this field existed just as well as an explicit `true`.
  const isApart = next.together === false && !!next.apart;
  const target = isApart ? apartTargetTurns() : targetTurnsFor(next.slot);
  const nextSpeaker: AgentId = Math.random() < 0.5 ? 'kevin' : 'jenny';
  const sceneId = `s${w.day}-${next.slot}-${w.seq++}`;
  // Apart: the scene has no single shared place, so its own `location` field
  // is just Kevin's (spec §A) — everything that actually needs to know where
  // EACH of them is reads `apart`/`w.agents[x].location` instead, never this.
  const sceneLocation: LocationId = isApart ? next.apart!.kevin.location : next.location;

  await insertScene(db, {
    id: sceneId, day: w.day, slot: next.slot, location: sceneLocation, title: next.title, setup: next.setup,
    event: next.event ?? null, mode: isApart ? 'apart' : 'together', apart: isApart ? next.apart : undefined,
  });

  w.scene = {
    id: sceneId, day: w.day, slot: next.slot, location: sceneLocation, title: next.title, setup: next.setup,
    turns: 0, target_turns: target, next_speaker: nextSpeaker, stale: 0, interrupted: false,
    bottle_id: next.bottle_id, opened_at: nowIso(), last_end_hint: false,
    mode: isApart ? 'apart' : 'together', apart: isApart ? next.apart : undefined,
  };
  if (isApart) {
    w.agents.kevin.location = next.apart!.kevin.location;
    w.agents.jenny.location = next.apart!.jenny.location;
  } else {
    w.agents.kevin.location = next.location;
    w.agents.jenny.location = next.location;
  }
  w.radio_requested = false;

  if (next.bottle_id) {
    await setBottle(db, next.bottle_id, { status: 'ashore', scene_id: sceneId });
    await updateInboxStatus(db, next.bottle_id, 'processing');
    w.last_bottle_day = w.day;
  }

  w.next = null;

  return { ok: true, calls: sumCalls(callsOut) };
}

const NOTHING_RE = /^nothing\.?$/i;

/** He/she for "said to himself"/"said to herself" — the two agents are fixed, so this is a plain lookup, not a guess. */
const REFLEXIVE: Record<AgentId, string> = { kevin: 'himself', jenny: 'herself' };

/**
 * Together transcript: one shared conversation, chronological.
 */
function buildTogetherTranscript(turns: SceneTurnRow[]): string {
  return turns.map((t) => {
    const name = BIOGRAPHIES[t.speaker].name;
    const parts: string[] = [];
    if (t.say.trim()) parts.push(`${name}: "${t.say.trim()}"`);
    if (t.action.trim() && !NOTHING_RE.test(t.action.trim())) parts.push(`(${name} ${t.action.trim()})`);
    return parts.join(' ') || `(${name} says and does nothing.)`;
  }).join('\n') || '(a quiet scene — little was said or done)';
}

/**
 * Apart transcript: TWO labelled, self-contained tracks — "KEVIN — alone at
 * the dock:" then his turns, then the same for Jenny (part 2 spec §A). This
 * is what the narrator reads for the whole scene, so each track has to read
 * on its own: a turn with an action but nothing said is `(did: …)`, one with
 * only speech is `said to himself/herself: "…"`, both together join, and a
 * turn with neither reports plainly rather than vanishing.
 */
function buildApartTranscript(w: World, scene: SceneState, turns: SceneTurnRow[]): string {
  const tracks = AGENT_IDS.map((id) => {
    const entry = scene.apart?.[id];
    const locId = entry?.location ?? w.agents[id].location;
    const locName = LOCATIONS[locId].name;
    const own = turns.filter((t) => t.speaker === id);
    const lines = own.map((t) => {
      const did = t.action.trim() && !NOTHING_RE.test(t.action.trim()) ? `(did: ${t.action.trim()})` : '';
      const said = t.say.trim() ? `said to ${REFLEXIVE[id]}: "${t.say.trim()}"` : '';
      return [did, said].filter(Boolean).join(' ') || '(did and said nothing)';
    });
    return `${BIOGRAPHIES[id].name.toUpperCase()} — alone at ${locName}:\n${lines.join('\n') || '(nothing to report)'}`;
  });
  return tracks.join('\n\n');
}

async function runCloseSceneJob(
  env: IslandEnv, db: D1Database, w: World, gone: Set<string>, goneOut: string[]
): Promise<JobOutcome> {
  const scene = w.scene;
  if (!scene) return { ok: true, calls: 0 }; // defensive — nothing to close

  const callsOut: number[] = [];
  const turns = await getSceneTurns(db, scene.id, 60);
  const transcript = scene.mode === 'apart'
    ? buildApartTranscript(w, scene, turns)
    : buildTogetherTranscript(turns);

  const result = await transition(env, db, w, transcript, gone, goneOut, callsOut);
  if (!result) return { ok: false, calls: sumCalls(callsOut) };

  const { t, model, event } = result;
  const applied = applyTransition(w, t, scene.id);

  await closeScene(db, scene.id, {
    summary: t.summary, outcomes_json: JSON.stringify(t.outcomes), turn_count: scene.turns, model,
  });

  if (applied.events.length) {
    await logEvents(db, applied.events.map((e) => ({
      day: w.day, slot: w.slot, kind: e.kind, who: e.who || 'world', detail: e.detail,
      data_json: e.data_json ?? null, scene_id: scene.id,
    })));
  }
  for (const n of applied.notebook) {
    await addNotebook(db, { day: w.day, author: n.author, kind: n.kind, content: n.content, location: n.location, scene_id: n.scene_id });
  }

  const closedSlot = scene.slot;
  // advanceSlot's own event seeds (a meal eaten, rain filling the tank, the
  // tank/pantry running low) were silently discarded here before — the code
  // ran, the world updated, but nothing ever told the timeline it happened.
  const slotEvents = advanceSlot(w);
  if (slotEvents.length) {
    await logEvents(db, slotEvents.map((e) => ({
      // Tagged with the slot that just ENDED (closedSlot), matching
      // applied.events above — advanceSlot already moved w.slot forward by
      // the time it returns, and these describe what happened AS that slot
      // closed, not what's about to happen in the new one.
      day: w.day, slot: closedSlot, kind: e.kind, who: e.who || 'world', detail: e.detail,
      data_json: e.data_json ?? null, scene_id: scene.id,
    })));
  }

  if (scene.bottle_id) {
    await setBottle(db, scene.bottle_id, { status: 'read' });
    await updateInboxStatus(db, scene.bottle_id, 'discussed');

    // Every bottle that gets READ should get a real reply — an agent's own
    // DO ("make letter: ...") already queues one during the scene when it
    // happens organically; this is the fallback for when it didn't.
    const alreadyQueued = w.jobs.some((j) => j.kind === 'make' && j.bottleId === scene.bottle_id);
    const existingReply = alreadyQueued ? null : await getBottle(db, scene.bottle_id);
    if (!alreadyQueued && !existingReply?.reply_artifact_id) {
      const note = await getInboxNote(db, scene.bottle_id);
      const bySpeaker: Record<AgentId, number> = { kevin: 0, jenny: 0 };
      for (const turn of turns) bySpeaker[turn.speaker]++;
      const replyAgent: AgentId = bySpeaker.jenny > bySpeaker.kevin ? 'jenny' : 'kevin';
      const authorName = note?.author?.trim() || 'a stranger';
      const madeToday = await countArtifactsToday(db, w.day);
      const queuedToday = w.jobs.filter((j) => j.kind === 'make').length;
      // Bottles take priority (unshift, ahead of anything else queued) but
      // still respect the day's overall make quota — this is a guaranteed
      // reply, not a free one.
      if (madeToday + queuedToday < MAKE_QUOTA_PER_DAY) {
        w.jobs.unshift({
          kind: 'make', agent: replyAgent, artifactKind: 'letter', title: `A reply to ${authorName}`,
          sceneId: scene.id, bottleId: scene.bottle_id,
          context: `${note?.content || ''}\n\n${t.summary}`.trim(),
        });
      }
    }
  }

  w.scene = null;
  w.radio_requested = false;

  if (closedSlot === 'night') {
    // Asleep from here until the dawn plan jobs finish — runOpenSceneJob's
    // morningSetup branch is what wakes them (part 2 spec §A).
    w.agents.kevin.activity = 'sleeping';
    w.agents.jenny.activity = 'sleeping';
    // A snapshot of skills AS OF tonight — computeDayMetrics (metrics.ts)
    // reads this for skill_total instead of loadWorld()'s live xp, which by
    // the time a delayed/retried chapter job actually runs could already
    // reflect a LATER day's growth. Shallow-copied: nothing after this point
    // mutates xp until tomorrow's scenes start.
    w.last_night_xp = { kevin: { ...w.agents.kevin.xp }, jenny: { ...w.agents.jenny.xp } };
    // A fresh day deserves its own morning call (yesterday + today's freshly
    // -made plans), not a straight carry-over of last night's proposed
    // continuation — so w.next is deliberately NOT stored here (spec §6).
    w.next = null;
    w.jobs.push(
      { kind: 'reflect', agent: 'kevin' }, { kind: 'reflect', agent: 'jenny' },
      { kind: 'chapter', day: w.day }, { kind: 'new_day' },
      { kind: 'plan', agent: 'kevin' }, { kind: 'plan', agent: 'jenny' }, { kind: 'open_scene' },
    );
  } else {
    w.next = { ...t.next, bottle_id: event?.bottleInboxId, event: event?.kind };
    w.jobs.push({ kind: 'open_scene' });
  }

  return { ok: true, calls: sumCalls(callsOut) };
}

async function runReflectJob(
  env: IslandEnv, db: D1Database, w: World, agent: AgentId, gone: Set<string>, goneOut: string[]
): Promise<JobOutcome> {
  const scenes = await getScenesForDay(db, w.day);
  const closed = scenes.filter((s) => s.status === 'closed');
  const material = closed.length
    ? closed.map((s) => `${s.title}: ${s.summary || s.setup}`).join('\n')
    : '(a quiet day)';
  const callsOut: number[] = [];
  const ok = await reflect(env, db, w, agent, material, gone, goneOut, callsOut);
  return { ok, calls: sumCalls(callsOut) };
}

async function runChapterJob(
  env: IslandEnv, db: D1Database, w: World, day: number, gone: Set<string>, goneOut: string[]
): Promise<JobOutcome> {
  const callsOut: number[] = [];
  const ok = await writeChapter(env, db, day, gone, goneOut, callsOut);
  return { ok, calls: sumCalls(callsOut) };
}

async function runMakeJob(
  env: IslandEnv, db: D1Database, w: World, job: QueuedJob, gone: Set<string>, goneOut: string[]
): Promise<JobOutcome> {
  const callsOut: number[] = [];
  const ok = await makeArtifact(env, db, w, job, gone, goneOut, callsOut);
  return { ok, calls: sumCalls(callsOut) };
}

async function runJob(
  env: IslandEnv, db: D1Database, w: World, job: QueuedJob, gone: Set<string>, goneOut: string[]
): Promise<JobOutcome> {
  switch (job.kind) {
    case 'plan': return runPlanJob(env, db, w, job.agent, gone, goneOut);
    case 'new_day': return runNewDayJob(db, w);
    case 'open_scene': return runOpenSceneJob(env, db, w, gone, goneOut);
    case 'close_scene': return runCloseSceneJob(env, db, w, gone, goneOut);
    case 'reflect': return runReflectJob(env, db, w, job.agent, gone, goneOut);
    case 'chapter': return runChapterJob(env, db, w, job.day, gone, goneOut);
    case 'make': return runMakeJob(env, db, w, job, gone, goneOut);
    default: return { ok: true, calls: 0 };
  }
}

// ── Radio cache refresh (independent of the AI-call budget; §6) ──

const RADIO_FEEDS = [
  'https://feeds.bbci.co.uk/news/world/rss.xml',
  'https://feeds.npr.org/1004/rss.xml',
  'https://www.aljazeera.com/xml/rss/all.xml',
];

function extractFeedTitles(xml: string, max: number): string[] {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  const titles: string[] = [];
  for (const item of items) {
    const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(item);
    if (!m) continue;
    let t = m[1].trim();
    const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(t);
    if (cdata) t = cdata[1].trim();
    t = t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
    if (t) titles.push(t.slice(0, 200));
    if (titles.length >= max) break;
  }
  return titles;
}

async function fetchFeedTitles(url: string): Promise<string[]> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'LivingCoreIsland/1.0 (+https://livingcore.cc)' },
    });
    if (!res.ok) return [];
    return extractFeedTitles(await res.text(), 6);
  } catch {
    return [];
  }
}

async function maybeRefreshRadioCache(db: D1Database): Promise<void> {
  const cache = await getRadioCache(db);
  const ageMs = cache ? Date.now() - Date.parse(cache.at) : Infinity;
  if (cache && Number.isFinite(ageMs) && ageMs < 6 * 60 * 60 * 1000) return;

  const results = await Promise.allSettled(RADIO_FEEDS.map(fetchFeedTitles));
  const titles: string[] = [];
  for (const r of results) if (r.status === 'fulfilled') titles.push(...r.value);

  if (titles.length || !cache) {
    await setRadioCache(db, titles.slice(0, 12));
  }
}

// ── runTick ──

export async function runTick(env: IslandEnv): Promise<TickResult> {
  if (!env.NVIDIA_API_KEY) {
    try { await setSystemState(env.DB, 'last_error', 'NVIDIA_API_KEY not configured'); } catch {}
    return { outcome: 'no_key', calls: 0, turns: 0, day: 0, slot: 'dawn', scene: null };
  }

  await ensureIslandSchema(env.DB);

  const lockToken = await acquireTickLock(env.DB, TICK_LOCK_TTL_MS);
  if (!lockToken) {
    return { outcome: 'busy', calls: 0, turns: 0, day: 0, slot: 'dawn', scene: null };
  }

  const tickStart = Date.now();
  const deadline = tickStart + TICK_WALL_BUDGET_MS;
  setCallDeadline(tickStart + TICK_CALL_DEADLINE_MS);
  let calls = 0;
  let turns = 0;
  let outcome = 'ok';
  let w: World | null = null;
  const goneFound: string[] = [];

  try {
    let loaded = await loadWorld(env.DB);
    if (!loaded) {
      loaded = initWorld(nowIso());
      await setIslandStartedAt(env.DB, loaded.updated_at);
      await logEvent(env.DB, {
        day: loaded.day, slot: loaded.slot, kind: 'era_start', who: 'world',
        detail: 'The island era begins.',
      });
    }
    w = loaded;

    const gone = await getGoneModels(env.DB);

    while (calls < MAX_CALLS_PER_TICK && Date.now() < deadline) {
      const usage = await getDailyUsage(env.DB);
      if (usage.messages >= DAILY_CALL_BUDGET * 0.9 || usage.tokens >= DAILY_TOKEN_BUDGET * 0.9) {
        outcome = 'budget_exhausted';
        break;
      }

      if (w.jobs.length > 0) {
        const job = w.jobs[0];
        /*
          A model-calling job needs real time: the scene-close narrator (5
          models, 45 s each), the chapter (60 s), reflections, plans. Started
          late in a tick — after two dialogue turns — it inherited a few seconds
          of the shared call deadline, every link was "skipped (tick deadline)",
          and the scene fell back to a no-op quiet stretch (seen live in
          production, 2026-09-26). If a model job would start with less than
          MIN_JOB_WINDOW_MS left, stop here: it runs FIRST next tick, with the
          whole budget. new_day and a stored open_scene cost no model call and
          are allowed any time.
        */
        const needsModel = job.kind !== 'new_day' && !(job.kind === 'open_scene' && w.next);
        if (needsModel && tickStart + TICK_CALL_DEADLINE_MS - Date.now() < MIN_JOB_WINDOW_MS) {
          outcome = 'deferred';
          break;
        }
        const result = await runJob(env, env.DB, w, job, gone, goneFound);
        calls += result.calls;

        // Find THIS job by reference, never assume it's still at index 0.
        // runCloseSceneJob's bottle-reply fallback can unshift a fresh 'make'
        // job onto the FRONT of w.jobs while `job` (still 'close_scene' at
        // that point — the outer loop hasn't shifted it off yet) is running,
        // which pushes `job` to index 1. A bare `w.jobs.shift()`/`w.jobs[0]
        // = ...` here then acts on that unrelated NEW job instead of the one
        // that actually just ran — on success it silently discards the
        // bottle's reply job before it ever executes (found live during
        // verification: two bottles read and discussed, neither ever
        // answered, with no job_dropped event and no error — the reply job
        // was being thrown away, not failing), and on failure it would
        // overwrite the wrong job's retry count instead of this job's.
        const idx = w.jobs.indexOf(job);
        if (result.ok) {
          if (idx !== -1) w.jobs.splice(idx, 1);
        } else {
          const tries = (job.tries || 0) + 1;
          if (tries >= 3) {
            if (idx !== -1) w.jobs.splice(idx, 1);
            await logEvent(env.DB, {
              day: w.day, slot: w.slot, kind: 'job_dropped', who: 'world',
              detail: `Gave up on "${job.kind}" after 3 failed attempts.`,
            });
          } else if (idx !== -1) {
            w.jobs[idx] = { ...job, tries };
          }
          outcome = 'stalled';
          break; // retry next tick
        }
        continue;
      }

      if (!w.scene) {
        w.jobs.push({ kind: 'open_scene' });
        continue;
      }

      // Re-read fresh every iteration — a scene can close and a new (possibly
      // differently-moded) one open within the same tick, and the cap has to
      // reflect whichever scene is live at THIS point in the loop.
      const turnCapThisTick = w.scene.mode === 'apart' ? MAX_TURNS_PER_TICK_APART : MAX_TURNS_PER_TICK;
      if (turns >= turnCapThisTick) break;

      const scene = w.scene;
      if (
        scene.turns >= scene.target_turns ||
        scene.stale >= 3 ||
        (scene.last_end_hint && scene.turns >= 4)
      ) {
        w.jobs.push({ kind: 'close_scene' });
        continue;
      }

      const speaker = scene.next_speaker;
      const speakCallsOut: number[] = [];
      const r = await speak(env, env.DB, w, speaker, gone, goneFound, speakCallsOut);
      if (!r) {
        // speakCallsOut still holds whatever real attempts the (failed) first
        // attemptSpeak call made — never assume 1.
        calls += sumCalls(speakCallsOut) || 1;
        outcome = 'stalled';
        break;
      }
      calls += sumCalls(speakCallsOut);

      // The SPEAKER'S OWN location, never scene.location — in an apart scene
      // scene.location is just "Kevin's place" (see runOpenSceneJob), which
      // would be flatly wrong on one of Jenny's turns. In a together scene
      // the two are always equal, so this changes nothing there.
      const speakerLocation = w.agents[speaker].location;
      let activity = activityFromDo(r.do, speakerLocation, w.slot);
      // The one fallback activityFromDo can't decide on its own: talking
      // needs to know the SAY and whether anyone's there to hear it, and
      // activityFromDo only ever sees the DO (part 2 spec §A).
      if (activity === 'idle' && r.say.trim() && scene.mode !== 'apart') activity = 'talking';
      w.agents[speaker].activity = activity;

      const meta = {
        era: 'island',
        protocol: PROTOCOL,
        scene_id: scene.id,
        sim_day: w.day,
        sim_slot: w.slot,
        location: speakerLocation,
        thought: r.thought,
        action: r.do,
        model: r.model,
        retries: r.retries,
        retry_reason: r.retry_reason ?? null,
        notebook_refs: JSON.stringify(r.notebookIds.map((id) => `note:${id}`)),
        memory_refs: JSON.stringify(r.recalledMemoryRefs),
        activity,
      };
      const thoughtsLine = `${BIOGRAPHIES[speaker].emoji} ${BIOGRAPHIES[speaker].name} · ${r.model} · ~${r.tokens} tok · island`;

      await insertTurn(env.DB, { speaker, say: r.say, thoughtsLine, turnGroup: scene.id, meta });

      scene.turns++;
      scene.stale = r.stale ? scene.stale + 1 : 0;
      scene.last_end_hint = r.endHint;
      scene.next_speaker = speaker === 'kevin' ? 'jenny' : 'kevin';
      turns++;

      if (r.radio) w.radio_requested = true;

      if (r.make) {
        // Best-effort quota: 1 make job queued per scene, 6 per day. Counts
        // an in-flight (queued-this-tick) make against the day's cap too,
        // even though it hasn't landed an artifact row yet.
        const alreadyThisScene = w.jobs.some((j) => j.kind === 'make' && j.sceneId === scene.id);
        if (!alreadyThisScene) {
          const madeToday = await countArtifactsToday(env.DB, w.day);
          const queuedToday = w.jobs.filter((j) => j.kind === 'make').length;
          if (madeToday + queuedToday < MAKE_QUOTA_PER_DAY) {
            const isBottleReply = !!scene.bottle_id && /letter|reply|note/i.test(r.make.kind);
            w.jobs.push({
              kind: 'make', agent: speaker, artifactKind: r.make.kind, title: r.make.title, sceneId: scene.id,
              bottleId: isBottleReply ? scene.bottle_id : undefined, context: r.say || r.do,
            });
          }
        }
      }
    }
  } catch (err) {
    outcome = 'error';
    try { await setSystemState(env.DB, 'last_error', String(err).slice(0, 300)); } catch {}
  } finally {
    if (w) {
      try { await saveWorld(env.DB, w); } catch {}
    }
    if (goneFound.length) {
      try { await markGone(env.DB, [...new Set(goneFound)]); } catch {}
    }
    setCallDeadline(null);
    // Radio feeds are outside fetches (up to 8 s): only when the lock still has room.
    if (Date.now() - tickStart < TICK_LOCK_TTL_MS - 20_000) {
      try { await maybeRefreshRadioCache(env.DB); } catch {}
    }
    await releaseTickLock(env.DB, lockToken);
  }

  return {
    outcome,
    calls,
    turns,
    day: w?.day ?? 0,
    slot: w?.slot ?? 'dawn',
    scene: w?.scene?.id ?? null,
  };
}

async function countArtifactsToday(db: D1Database, day: number): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) as n FROM artifacts WHERE day = ?`).bind(day).first<{ n: number }>();
  return row?.n ?? 0;
}

// ── publicWorld — the ONLY shape a visitor's browser ever sees ──
// Implemented for real (pure, no DB): deliberately excludes anything private
// (journals, memories, plans, wants, interludes, job queue, hidden pressure)
// so /api/poll and /api/world can never accidentally leak them.

export interface PublicAgent {
  location: LocationId;
  energy: number;
  hunger: number;
  mood: number;
  health: Health;
  /** What they're visibly doing right now, for the map (part 2 spec §A). */
  activity: Activity;
}

export interface PublicScene {
  id: string;
  title: string;
  setup: string;
  location: LocationId;
  turns: number;
  target: number;
  /** 'together' or 'apart' (missing on the underlying SceneState = 'together'). */
  mode: 'together' | 'apart';
  /** Set only when mode = 'apart': each agent's own place, what they're doing, and their own setup text. */
  apart?: Record<AgentId, { location: LocationId; doing: string; setup: string }>;
}

export interface PublicWorld {
  day: number;
  slot: Slot;
  season: Season;
  weather: Weather;
  tide: 'low' | 'rising' | 'high' | 'falling';
  barometer: string;
  resources: World['resources'];
  agents: Record<AgentId, PublicAgent>;
  scene: PublicScene | null;
  projects: Project[];
  discovered: LocationId[];
  supply: World['supply'];
}

function toPublicAgent(a: AgentState): PublicAgent {
  // `?? 'idle'` tolerates a world saved before AgentState.activity existed.
  return { location: a.location, energy: a.energy, hunger: a.hunger, mood: a.mood, health: a.health, activity: a.activity ?? 'idle' };
}

export function publicWorld(w: World): PublicWorld {
  const agents = {} as Record<AgentId, PublicAgent>;
  for (const id of AGENT_IDS) agents[id] = toPublicAgent(w.agents[id]);

  return {
    day: w.day,
    slot: w.slot,
    season: w.season,
    weather: w.weather,
    tide: tide(w.day, w.slot),
    barometer: barometerLine(w),
    resources: w.resources,
    agents,
    scene: w.scene
      ? {
          id: w.scene.id, title: w.scene.title, setup: w.scene.setup, location: w.scene.location,
          turns: w.scene.turns, target: w.scene.target_turns,
          mode: w.scene.mode ?? 'together', apart: w.scene.apart,
        }
      : null,
    projects: w.projects,
    discovered: w.discovered,
    supply: w.supply,
  };
}
