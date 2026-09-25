// ─────────────────────────────────────────────────────────────────────────────
// THE ISLAND ERA — shared types.
//
// Everything that crosses a module boundary in src/world/ is declared here, so
// the engine, the pages, the exports and the Lab all agree on one shape.
//
// Design rule (see docs/ISLAND.md): the WORLD is deterministic code — clock,
// weather, water, food, fatigue, dice. The MODELS supply only two things:
// what Kevin and Jenny think / say / do, and (the narrator) how the world
// answers what they did. The narrator never writes their words or chooses for
// them, and every number it proposes is clamped by code before it lands.
// ─────────────────────────────────────────────────────────────────────────────

export type AgentId = 'kevin' | 'jenny';
export const AGENT_IDS: AgentId[] = ['kevin', 'jenny'];

/** Six beats in an island day. A scene happens in one of them. */
export type Slot = 'dawn' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';
export const SLOTS: Slot[] = ['dawn', 'morning', 'midday', 'afternoon', 'evening', 'night'];

export type WeatherKind = 'clear' | 'cloudy' | 'windy' | 'rain' | 'storm' | 'fog' | 'heat';
export type Season = 'dry' | 'wet';

export interface Weather {
  kind: WeatherKind;
  /** 0 = barely, 3 = severe. A storm is always >= 2. */
  intensity: number;
  temp_c: number;
  /** Plain-language line the agents and the page both read, e.g. "Warm, steady trade wind". */
  line: string;
}

/** Location ids are fixed; `discovered` gates whether anyone may go there. */
export type LocationId =
  | 'cottage' | 'garden' | 'dock' | 'beach' | 'tidepools' | 'woods' | 'spring'
  | 'hilltop' | 'cliffs' | 'lighthouse' | 'cave' | 'wreck' | 'cove';

export interface Location {
  id: LocationId;
  name: string;
  /** What a person standing there notices. Fed to the narrator, shown on the map. */
  description: string;
  /** Position on the 1000×640 island map (public/island.svg coordinates). */
  x: number;
  y: number;
  discoveredAtStart: boolean;
  /** How it can be found, for the narrator (never shown before discovery). */
  hiddenHint?: string;
}

export type Health = 'well' | 'tired' | 'hurt' | 'sick';

/**
 * What a figure on the island map is visibly doing right now (part 2 spec §A).
 * Derived from a spoken turn's DO text by src/world/activity.ts#activityFromDo,
 * and separately by night/sleep bookkeeping in tick.ts. Purely a rendering/
 * presentation signal — nothing in the simulation itself reads it back.
 */
export type Activity =
  | 'sleeping' | 'cooking' | 'eating' | 'fishing' | 'chopping' | 'foraging' | 'gardening'
  | 'sketching' | 'repairing' | 'building' | 'walking' | 'exploring' | 'swimming' | 'radio'
  | 'writing' | 'resting' | 'talking' | 'idle';

export interface AgentState {
  location: LocationId;
  /** 0 (exhausted) – 100 (rested). Drains with work and time, restored by sleep/food. */
  energy: number;
  /** 0 (full) – 100 (starving). Rises every slot, falls when they eat. */
  hunger: number;
  /** -5 (miserable) … +5 (elated). */
  mood: number;
  health: Health;
  /**
   * What they're visibly doing right now, for the map (default 'idle';
   * initWorld sets 'resting'). A world saved before this field existed has no
   * `activity` at all — every reader must tolerate that (`?? 'idle'`), the
   * same tolerance pattern SceneState.last_end_hint already uses below.
   */
  activity: Activity;
  /** A short private note on an injury/illness, or ''. */
  condition: string;
  /** Skill name → experience points. Level = floor(sqrt(xp / 2)), capped at 10. */
  xp: Record<string, number>;
  /** Today's private intentions, written at dawn by the agent itself. */
  plan: string[];
  /** A long-running private want. Starts from the biography; reflection may rewrite it. */
  want: string;
  /** What happened to them alone since they last saw their partner (private). */
  interlude: string;
}

export type ProjectStatus = 'idea' | 'active' | 'done' | 'stalled' | 'abandoned';

export interface Project {
  id: string;
  name: string;
  owners: AgentId[];
  /** 0–100. Only the narrator's clamped deltas move it. */
  progress: number;
  status: ProjectStatus;
  started_day: number;
  finished_day?: number;
  /** One line: where it stands / what it needs next. */
  note: string;
}

export interface Item {
  id: string;
  name: string;
  note: string;
  where: LocationId | 'carried';
  found_day: number;
}

export interface SceneState {
  id: string;
  day: number;
  slot: Slot;
  location: LocationId;
  title: string;
  /** Present-tense narration of what is physically happening as the scene opens. */
  setup: string;
  turns: number;
  target_turns: number;
  next_speaker: AgentId;
  /** Consecutive turns that were stale (no new action, repeated words). */
  stale: number;
  /** An event already interrupted this scene (at most one mid-scene event). */
  interrupted: boolean;
  /** Pending visitor bottle being read in this scene, if any. */
  bottle_id?: number;
  opened_at: string;
  /**
   * Whether the LAST turn spoken in this scene read as leaving/sleeping
   * (agent.ts's speak() endHint). Lives on the scene, not a tick-local
   * variable, because a scene spans many cron ticks and tick.ts's
   * "close early on an end hint" check (spec §6) must see a hint from a
   * turn spoken in an earlier tick just as well as one from this tick.
   */
  last_end_hint?: boolean;
  /**
   * 'together' (both agents at `location`) or 'apart' (each at their own
   * place — see `apart`). Optional because a scene saved before this field
   * existed has none: missing = 'together' (part 2 spec §A).
   */
  mode?: 'together' | 'apart';
  /**
   * Set only when `mode === 'apart'`: each agent's own place, what they're
   * doing there, and the present-tense setup they were each given. `location`
   * above is then just "Kevin's apart location" (tick.ts's open_scene) — the
   * scene has no single shared place while apart.
   */
  apart?: Record<AgentId, { location: LocationId; doing: string; setup: string }>;
}

/**
 * Jobs that run between scenes, one or two per cron tick, so a tick never
 * has to do a whole night's work at once.
 */
export type Job =
  | { kind: 'close_scene' }
  | { kind: 'reflect'; agent: AgentId }
  | { kind: 'chapter'; day: number }
  | { kind: 'new_day' }
  | { kind: 'plan'; agent: AgentId }
  | { kind: 'open_scene' }
  | { kind: 'make'; agent: AgentId; artifactKind: string; title: string; sceneId: string; bottleId?: number; context?: string };

/** A job plus its failure count; a job that fails on 3 ticks in a row is dropped (logged as 'job_dropped'). */
export type QueuedJob = Job & { tries?: number };

/** The opening of the next scene, as written by the narrator at the previous boundary. */
export interface NextScene {
  slot: Slot;
  /** When `together` is false, this is still whatever the narrator wrote for the shared "location" field of its JSON reply — not necessarily where either of them is. Use `apart` instead. */
  location: LocationId;
  title: string;
  setup: string;
  /** The world event woven into it, if any (kind from the event table). */
  event?: string;
  /** A visitor bottle that washes up in this scene. */
  bottle_id?: number;
  /**
   * Whether they're together at `location` next, or apart (see `apart`).
   * Optional because morningSetup() never sets it (a day always opens
   * together) and a `next` saved before this field existed has none: missing
   * = true (part 2 spec §A).
   */
  together?: boolean;
  /** Set only when `together === false`: each agent's own place, what they're doing there, and their own present-tense setup. */
  apart?: Record<AgentId, { location: LocationId; doing: string; setup: string }>;
}

export interface World {
  v: 1;
  /** Island day, 1-based. Day 1 is the first day of the island era. */
  day: number;
  slot: Slot;
  season: Season;
  weather: Weather;
  resources: {
    /** Litres in the rain tank. Capacity 400. */
    water_l: number;
    /** Days of food for two in the pantry (stores + what they caught/grew). */
    food_days: number;
    /** Armfuls of dry firewood. */
    firewood: number;
  };
  items: Item[];
  discovered: LocationId[];
  agents: Record<AgentId, AgentState>;
  projects: Project[];
  /** The supply boat from the trust: due day, and whether weather has delayed it. */
  supply: { due_day: number; delayed_days: number };
  scene: SceneState | null;
  jobs: QueuedJob[];
  /** Set by close_scene, consumed by open_scene. Null at dawn (the morning setup call writes it). */
  next: NextScene | null;
  /** Island day on which the last visitor bottle washed up (so they don't arrive every scene). */
  last_bottle_day: number;
  /**
   * Snapshot of each agent's skill xp taken the moment the NIGHT scene
   * closed (tick.ts's runCloseSceneJob) — metrics.ts's computeDayMetrics
   * reads this for skill_total instead of the live `agents[x].xp`, which by
   * the time a delayed/retried chapter job actually runs could already
   * reflect a later day's growth. Optional/undefined before the first night
   * has ever closed (e.g. mid-way through day 1).
   */
  last_night_xp?: Record<AgentId, Record<string, number>>;
  /** Hidden weather driver: the barometer shows pressure + trend to the agents; the rule linking it to rain is theirs to learn. */
  hidden: { pressure: number; trend: number };
  /** Kinds of the last few world events, so the event table does not repeat itself. */
  recent_events: string[];
  /** Scene-level flags the transition needs: someone listened to the radio this scene. */
  radio_requested: boolean;
  /** Monotonic counter for short ids. */
  seq: number;
  updated_at: string;
}

/** One parsed agent turn. `say` is what the partner hears; `thought` is private. */
export interface ParsedTurn {
  thought: string;
  say: string;
  do: string;
  /** [remember: …] notes lifted out of the text. */
  remember: string[];
  /** A DO that asks to make something: { kind, title }. */
  make?: { kind: string; title: string };
}

/** What the narrator returns at a scene boundary, AFTER clamping. */
export interface Transition {
  summary: string;
  outcomes: { who: AgentId | 'world'; action: string; result: string; success: boolean }[];
  resources: { water_l: number; food_days: number; firewood: number };
  agents: Record<AgentId, { energy: number; hunger: number; mood: number; location: LocationId; health?: Health; condition?: string }>;
  xp: { who: AgentId; skill: string; amount: number }[];
  projects: { name: string; progress: number; status?: ProjectStatus; owners?: AgentId[]; note?: string }[];
  items: { name: string; note: string; where: LocationId | 'carried' }[];
  discoveries: { who: AgentId; fact: string; location?: LocationId }[];
  newly_discovered: LocationId[];
  interludes: Record<AgentId, string>;
  /**
   * `together`/`apart` are always set by clampTransition (never left
   * optional here — unlike NextScene/SceneState, a Transition is never
   * persisted across a deploy, it's built and consumed within one job).
   */
  next: {
    slot: Slot; location: LocationId; title: string; setup: string;
    together: boolean;
    apart?: Record<AgentId, { location: LocationId; doing: string; setup: string }>;
  };
}

/** Rows as stored in D1 (see src/world/store.ts). */
export interface TurnMetaRow {
  turn_id: number;
  era: string;
  protocol: string;
  scene_id: string;
  sim_day: number;
  sim_slot: Slot;
  location: LocationId;
  thought: string;
  action: string;
  model: string;
  retries: number;
  retry_reason: string | null;
  notebook_refs: string;
  memory_refs: string;
  /** What the speaker was visibly doing on this turn (activity.ts#activityFromDo). Column added part 2 spec §A; self-healed via ALTER TABLE for a DB that predates it. */
  activity: Activity;
  created_at: string;
}

export interface SceneRow {
  id: string;
  day: number;
  slot: Slot;
  location: LocationId;
  title: string;
  setup: string;
  event: string | null;
  status: 'open' | 'closed';
  summary: string | null;
  outcomes_json: string | null;
  turn_count: number;
  model: string | null;
  opened_at: string;
  closed_at: string | null;
  /** 'together' or 'apart'. Column DEFAULTs to 'together', so a pre-existing row reads as together after the ALTER TABLE self-heal. */
  mode: 'together' | 'apart';
  /** JSON of `SceneState.apart` when mode = 'apart', else null. */
  apart_json: string | null;
}

export interface NotebookRow {
  id: number;
  day: number;
  author: AgentId | 'both';
  kind: 'discovery' | 'lesson' | 'species' | 'recipe' | 'fact';
  content: string;
  location: string | null;
  scene_id: string | null;
  uses: number;
  created_at: string;
}

export interface ArtifactRow {
  id: number;
  day: number;
  maker: AgentId;
  kind: string;
  title: string;
  content: string;
  format: 'text' | 'svg';
  scene_id: string | null;
  inbox_id: number | null;
  model: string;
  created_at: string;
}

export interface ChapterRow {
  day: number;
  title: string;
  body: string;
  model: string;
  stats_json: string;
  created_at: string;
}

export interface WorldEventRow {
  id: number;
  day: number;
  slot: Slot;
  kind: string;
  who: string;
  detail: string;
  data_json: string | null;
  scene_id: string | null;
  created_at: string;
}
