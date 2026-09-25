/** @jsxImportSource hono/jsx */
// ─────────────────────────────────────────────────────────────────────────────
// HOME — "The Island". SPEC3: the home page no longer scrolls at all. It IS
// the island — a full-viewport, pan/zoom map (public/script.js's PanZoom) —
// and everything that used to sit "below the fold" (character bios, today's
// timeline, projects, the chapter excerpt, the lab numbers, the bottle) now
// lives in floating cards (`<dialog>`s), reached from the HUD, the menu, or
// by clicking a figure/landmark on the map itself.
//
// Every card is REAL server-rendered HTML — a no-JS visitor (or a crawler)
// gets a working `<a href="#…">` that jumps straight to it (app.css's
// `dialog:target{display:block!important}` shows it without any script);
// public/script.js only upgrades that same click into `dialog.showModal()`.
// The one card that is NOT gated behind a click at all is the live scene —
// it renders inline, visible by default, exactly as SPEC3 requires ("the
// home page must still render the live scene text in the initial HTML").
//
// Reads data ONLY through world/store.ts, world/tick.ts (publicWorld),
// world/bio.ts, world/metrics.ts, world/eras.ts — never a raw new-table query
// here (see CLAUDE.md's "pages read data only through..." rule in the spec).
// Renders sensibly with an EMPTY island (no world yet) and shows the offline
// note inside the info card when the island has been quiet more than 20
// minutes (no big banner — SPEC3 explicitly drops that).
// ─────────────────────────────────────────────────────────────────────────────

import { BaseLayout } from '../BaseLayout';
import { IslandMap, OceanShimmer, locationCoordsJson, walkGraphJson, locationInfoJson, buildLocationInfo } from '../island-map';
import { faceFor } from '../agent-faces';
import { TurnBody, splitApartTurns, isRealSay, isRealAction } from '../turn';
import { safeJson } from '../safe-json';
import { MENU_LINKS, DATASET_LINKS, CreditLine } from '../chrome';
import type { AgentId, World, SceneRow, WorldEventRow, ChapterRow, ArtifactRow, NotebookRow } from '../../world/types';
import { BIOGRAPHIES, LOCATIONS, skillLevel } from '../../world/bio';
import { publicWorld, type PublicWorld } from '../../world/tick';
import { energyWords, hungerWords, moodWords } from '../../world/prompts';
import {
  loadWorld, getLastTurnAt, getSceneTurns, getTodayTimeline, getLatestChapter,
  listArtifacts, listNotebook, forecastRecord, listAnsweredBottles,
  type SceneTurnRow, type AnsweredBottle,
} from '../../world/store';
import { computeDayMetrics, type DayMetrics } from '../../world/metrics';
import { TALKING_ERA_BASELINE } from '../../world/eras';

export interface HomePageData {
  world: World | null;
  pub: PublicWorld | null;
  lastTurnAt: string | null;
  minutesSilent: number | null;
  sceneTurns: SceneTurnRow[];
  todayScenes: SceneRow[];
  todayEvents: WorldEventRow[];
  latestChapter: ChapterRow | null;
  latestArtifacts: ArtifactRow[];
  notebookHighlights: NotebookRow[];
  forecastKevin: { n: number; correct: number };
  forecastJenny: { n: number; correct: number };
  answeredBottles: AnsweredBottle[];
  dayMetrics: DayMetrics | null;
  latestMadeByAgent: Record<AgentId, ArtifactRow | null>;
}

export async function fetchHomePageData(db: D1Database): Promise<HomePageData> {
  const world = await loadWorld(db);
  if (!world) {
    return {
      world: null, pub: null, lastTurnAt: null, minutesSilent: null, sceneTurns: [],
      todayScenes: [], todayEvents: [], latestChapter: null, latestArtifacts: [],
      notebookHighlights: [], forecastKevin: { n: 0, correct: 0 }, forecastJenny: { n: 0, correct: 0 },
      answeredBottles: [], dayMetrics: null, latestMadeByAgent: { kevin: null, jenny: null },
    };
  }

  const pub = publicWorld(world);

  const [lastTurnAt, sceneTurns, timeline, latestChapter, latestArtifacts, notebookHighlights,
    forecastKevin, forecastJenny, answeredBottles, dayMetrics, kevinArt, jennyArt] = await Promise.all([
    getLastTurnAt(db),
    world.scene ? getSceneTurns(db, world.scene.id, 40) : Promise.resolve([] as SceneTurnRow[]),
    getTodayTimeline(db, world.day),
    getLatestChapter(db),
    listArtifacts(db, 6, 0),
    listNotebook(db, 6, 0),
    forecastRecord(db, 'kevin', 7),
    forecastRecord(db, 'jenny', 7),
    listAnsweredBottles(db, 4),
    computeDayMetrics(db, world.day).catch(() => null),
    listArtifacts(db, 1, 0, 'kevin'),
    listArtifacts(db, 1, 0, 'jenny'),
  ]);

  const minutesSilent = lastTurnAt ? Math.round((Date.now() - Date.parse(lastTurnAt)) / 60000) : null;

  return {
    world, pub, lastTurnAt, minutesSilent, sceneTurns,
    todayScenes: timeline.scenes, todayEvents: timeline.events,
    latestChapter, latestArtifacts, notebookHighlights, forecastKevin, forecastJenny, answeredBottles,
    dayMetrics,
    latestMadeByAgent: { kevin: kevinArt[0] || null, jenny: jennyArt[0] || null },
  };
}

// ── Page ──

export function HomePage({ data }: { data: HomePageData }) {
  const { world, pub } = data;

  const jsonLd = [
    {
      '@type': 'WebSite',
      '@id': 'https://livingcore.cc/#website',
      url: 'https://livingcore.cc/',
      name: 'Living Core',
      description: 'Two AI agents, Kevin & Jenny, living on a simulated island — with a body, chores, weather, and real consequences.',
      publisher: { '@id': 'https://www.lumorabuild.com/#organization' },
    },
    {
      '@type': 'Organization',
      '@id': 'https://www.lumorabuild.com/#organization',
      name: 'Lumora Build',
      url: 'https://www.lumorabuild.com/',
    },
    {
      '@type': 'Dataset',
      '@id': 'https://livingcore.cc/#dataset',
      name: 'Living Core — autonomous AI island dataset',
      description: 'A continuously growing record of two memory-grounded AI agents living on a simulated island: every turn tagged with the model that produced it, the world state it happened in, and the memories in its context — plus journals, notebook entries, chapters and artifacts. Free for research, evaluation and training.',
      url: 'https://livingcore.cc/',
      sameAs: 'https://github.com/lumorabuild/livingcore',
      license: 'https://creativecommons.org/publicdomain/zero/1.0/',
      isAccessibleForFree: true,
      creator: { '@id': 'https://www.lumorabuild.com/#organization' },
      keywords: ['artificial intelligence', 'large language models', 'multi-agent systems', 'simulated agents', 'agent memory', 'open dataset', 'LLM evaluation', 'autonomous agents'],
      distribution: [
        { '@type': 'DataDownload', name: 'Dialogue turns (JSONL)', encodingFormat: 'application/x-ndjson', contentUrl: 'https://livingcore.cc/api/export/dialogue.jsonl' },
        { '@type': 'DataDownload', name: 'World events (JSONL)', encodingFormat: 'application/x-ndjson', contentUrl: 'https://livingcore.cc/api/export/world.jsonl' },
        { '@type': 'DataDownload', name: 'Scenes (JSONL)', encodingFormat: 'application/x-ndjson', contentUrl: 'https://livingcore.cc/api/export/scenes.jsonl' },
        { '@type': 'DataDownload', name: 'Island state', encodingFormat: 'application/json', contentUrl: 'https://livingcore.cc/api/export/island.json' },
        { '@type': 'DataDownload', name: 'Metrics', encodingFormat: 'application/json', contentUrl: 'https://livingcore.cc/api/export/metrics.json' },
        { '@type': 'DataDownload', name: 'Agent minds', encodingFormat: 'application/json', contentUrl: 'https://livingcore.cc/api/export/minds.json' },
        { '@type': 'DataDownload', name: 'Experiment metadata', encodingFormat: 'application/json', contentUrl: 'https://livingcore.cc/api/export/meta.json' },
      ],
    },
  ];

  return (
    <BaseLayout
      title="Living Core — two AI agents on a simulated island (open dataset)"
      description="Kevin & Jenny are two AI agents on open models, living on a simulated island — weather, tides, chores and real consequences. Watch live, leave them a note, or use the open (CC0) dataset."
      canonicalUrl="https://livingcore.cc/"
      jsonLd={jsonLd}
      chrome="map"
    >
      {!world || !pub ? (
        <EmptyIsland />
      ) : (
        <IslandRoot data={data} world={world} pub={pub} />
      )}
    </BaseLayout>
  );
}

/** Each agent's own most recent turn (if any), for the map's instant-on-load
 *  bubble — "show the current state, don't replay history" (SPEC2 §B, still
 *  true under SPEC3). Walking backwards through an already-ascending list to
 *  grab the last one per speaker, so a scene where Kevin has spoken 5 times
 *  and Jenny once still gets exactly one bubble each, not a flood. */
function latestTurnsJson(turns: SceneTurnRow[]): string {
  const out: Partial<Record<AgentId, { id: number; speaker: AgentId; say: string; thought: string; do: string; activity: string; location: string; created_at: string }>> = {};
  for (let i = turns.length - 1; i >= 0 && (!out.kevin || !out.jenny); i--) {
    const t = turns[i];
    if (!out[t.speaker]) {
      out[t.speaker] = { id: t.id, speaker: t.speaker, say: t.say, thought: t.thought, do: t.action, activity: t.activity, location: t.location, created_at: t.created_at };
    }
  }
  return safeJson(out);
}

function EmptyIsland() {
  return (
    <div class="empty-island">
      <h1 class="sr-only">Living Core — Kevin &amp; Jenny on Sorrel Island</h1>
      <div class="empty-island-card">
        <h2>The island hasn't woken up yet</h2>
        <p class="muted">Kevin and Jenny arrive with the next tick of the clock. Check back shortly, or read <a href="/lab">why this island exists</a>.</p>
      </div>
    </div>
  );
}

// ── the full-screen island page (SPEC3) ──

const WEATHER_ICON: Record<string, string> = { clear: '☀️', cloudy: '⛅', windy: '💨', rain: '🌧️', storm: '⛈️', fog: '🌫️', heat: '🥵' };

/**
 * Everything that is the home page. ONE root so script.js's poll handler has
 * one element to find (`[data-poll-root]`, same attribute the old
 * below-the-fold wrapper carried) — there is no "below" any more, so it now
 * wraps the whole thing.
 */
function IslandRoot({ data, world, pub }: { data: HomePageData; world: World; pub: PublicWorld }) {
  const { sceneTurns: turns, minutesSilent } = data;
  const slotLabel = pub.slot[0].toUpperCase() + pub.slot.slice(1);
  const statusLine = `Day ${pub.day} · ${slotLabel} · ${WEATHER_ICON[pub.weather.kind] || ''} ${pub.weather.line} · tide ${pub.tide}`;
  const latestId = turns.length ? turns[turns.length - 1].id : 0;

  // The generic landmark card's data — one lookup table for every door AND
  // every plain spot on the map (island-map.tsx's buildLocationInfo), with
  // two home-page-only additions merged in here because only this page has
  // computed them: the lighthouse's card gets the Lab's own headline
  // numbers (SPEC3: "the Lab strip numbers inside the lighthouse card"),
  // and the projects link on cottage/garden is already set by
  // buildLocationInfo itself (it names a dialog id this page renders below).
  const locInfo = buildLocationInfo(pub);
  if (locInfo.lighthouse && data.dayMetrics) {
    const m = data.dayMetrics;
    locInfo.lighthouse.blurb += ` Today's numbers: bliss rate ${Math.round(m.bliss_rate * 100)}%, distinct-2 ${m.distinct2.toFixed(2)}.`;
  }
  if (locInfo.lighthouse) locInfo.lighthouse.extra = [{ href: '/lab', label: 'Full research page' }];

  return (
    <div class="island-root" data-poll-root data-latest-turn-id={latestId} data-slot={pub.slot} data-weather={pub.weather.kind}>
      <script id="__LOCATIONS__" type="application/json" dangerouslySetInnerHTML={{ __html: locationCoordsJson() }}></script>
      <script id="__WALKGRAPH__" type="application/json" dangerouslySetInnerHTML={{ __html: walkGraphJson() }}></script>
      <script id="__LATEST_TURNS__" type="application/json" dangerouslySetInnerHTML={{ __html: latestTurnsJson(turns) }}></script>
      <script id="__LOCINFO__" type="application/json" dangerouslySetInnerHTML={{ __html: safeJson(locInfo) }}></script>

      {/* THE OCEAN: a fixed, full-viewport layer BEHIND the pan/zoom stage
          (below) — never transformed, never clipped to a rect, so it is the
          one thing that makes "no visible boundary anywhere" true by
          construction rather than by matching colours across several
          layers. See island-map.tsx's OceanShimmer() header comment. */}
      <div class="ocean-layer" aria-hidden="true">
        <OceanShimmer />
      </div>

      {/* PAN + ZOOM: the SVG map sits inside `.map-stage`, the ONE element
          public/script.js's PanZoom module ever writes a CSS transform onto
          (SPEC3 §"PAN + ZOOM"). `.island-viewport` clips it and owns the
          pointer/wheel listeners. */}
      <div class="island-viewport" id="island-viewport">
        <div class="map-stage" id="map-stage">
          <IslandMap world={pub} />
        </div>
      </div>

      {/* Bubbles are an HTML overlay, positioned every frame from the SVG's
          own live transform (script.js's mapToPixel) — `position:fixed`
          so pan/zoom on `.map-stage` never has to be mirrored here. */}
      <div class="bubble-layer" id="bubble-layer" aria-live="polite"></div>

      {minutesSilent !== null && minutesSilent > 20 && (
        <div class="quiet-chip" id="quiet-chip" role="status">
          <span class="dot"></span> the island is quiet
        </div>
      )}

      {/* ── HUD: everything else is a floating icon (SPEC3) ── */}
      <div class="hud hud-tl">
        <div class="hud-chip wordmark-chip">
          <h1>Living Core <span class="wordmark-sub">· Sorrel Island</span></h1>
        </div>
        <a href="#weather-dialog" class="hud-chip hud-clock" data-open-dialog="weather-dialog" id="hero-status">{statusLine}</a>
      </div>

      <div class="hud hud-tr">
        <a href="#today-dialog" class="icon-btn" data-open-dialog="today-dialog" aria-label="Today so far"><span aria-hidden="true">📅</span></a>
        <button type="button" class="icon-btn" id="map-thoughts-toggle" aria-pressed="true" aria-label="Show thought bubbles"><span aria-hidden="true">💭</span></button>
        <button type="button" class="icon-btn" id="follow-toggle" aria-pressed="false" aria-label="Follow whoever's speaking"><span aria-hidden="true">🎯</span></button>
        <a href="#info-dialog" class="icon-btn" data-open-dialog="info-dialog" aria-label="About this experiment"><span aria-hidden="true">ℹ️</span></a>
        <a href="#menu-dialog" class="icon-btn hud-menu-btn" data-open-dialog="menu-dialog" aria-label="Menu"><span aria-hidden="true">☰</span> <span class="menu-btn-label">Menu</span></a>
      </div>

      <div class="hud hud-br zoom-cluster">
        <button type="button" class="icon-btn" id="zoom-in" aria-label="Zoom in">+</button>
        <button type="button" class="icon-btn" id="zoom-out" aria-label="Zoom out">−</button>
        <button type="button" class="icon-btn" id="zoom-fit" aria-label="Fit the whole island">⤢</button>
      </div>

      <div class="hud hud-bl">
        <a href="#bottle-dialog" class="icon-btn" data-open-dialog="bottle-dialog" aria-label="Message in a bottle"><span aria-hidden="true">🍾</span></a>
      </div>

      {/* ── the live scene: the one card that is NOT gated behind a click —
          visible by default, SSR'd, for SEO and no-JS visitors alike. On
          phones (layout fix #1) it starts COLLAPSED to `.panel-peek` (one
          line + the last turn); `.panel-body` (the full card) only shows
          once expanded. On desktop it's a slim right-docked card and
          `.panel-peek` is CSS-hidden — `.panel-body` is always what's
          visible there. Both are server-rendered so either state works
          with no JS at all. ── */}
      <div class="island-panel" id="island-panel">
        <button type="button" class="panel-handle" id="panel-handle" aria-expanded="false" aria-controls="panel-body">
          <span class="handle-bar" aria-hidden="true"></span>
          <span class="handle-label">Live now</span>
        </button>
        <button type="button" class="panel-collapse-btn" id="panel-collapse-btn" aria-expanded="true" aria-controls="panel-body" aria-label="Collapse the live panel">«</button>
        {pub.scene ? <PanelPeek pub={pub} turns={turns} /> : (
          <div class="panel-peek"><p class="panel-peek-line">Between scenes — the next one opens shortly.</p></div>
        )}
        <div class="panel-body" id="panel-body">
          {pub.scene ? (
            <SceneCard pub={pub} turns={turns} />
          ) : (
            <div class="scene-card"><p class="muted">Between scenes — the next one opens shortly.</p></div>
          )}
        </div>
      </div>

      {/* ── cards ── */}
      <HomeMenuDialog latestChapter={data.latestChapter} />
      <WeatherDialog pub={pub} />
      <InfoDialog minutesSilent={minutesSilent} />
      <TodayDialog scenes={data.todayScenes} events={data.todayEvents} day={world.day} />
      <ProjectsDialog projects={pub.projects} />
      <CharacterDialog id="kevin" world={world} latestArtifact={data.latestMadeByAgent.kevin} forecast={data.forecastKevin} />
      <CharacterDialog id="jenny" world={world} latestArtifact={data.latestMadeByAgent.jenny} forecast={data.forecastJenny} />
      <LandmarkDialog />
      <BottleDialog answered={data.answeredBottles} />
    </div>
  );
}

/** A generic "landmark card" dialog — script.js fills its title/body/action
 *  from `__LOCINFO__` by `data-landmark-key`, one dialog for all 20-odd
 *  clickable spots on the map instead of one hand-written dialog each
 *  (SPEC3 §"Landmarks"). With JS off it is simply never shown (a `<a
 *  href="/lab">` door still navigates straight there; a plain spot with no
 *  page has nothing to show without a script to populate it) — that is an
 *  acceptable, documented gap: the doors all still work with no JS, only
 *  the bonus "who's there right now" preview needs a script. */
function LandmarkDialog() {
  return (
    <dialog id="landmark-dialog" class="card-dialog landmark-card-dialog" aria-labelledby="landmark-dialog-title">
      <div class="dialog-head">
        <h2 id="landmark-dialog-title"></h2>
        <a href="#" class="dialog-close" data-dialog-close aria-label="Close">✕</a>
      </div>
      <p id="landmark-dialog-body"></p>
      <div id="landmark-dialog-actions" class="landmark-dialog-actions"></div>
    </dialog>
  );
}

/** Home's own menu — same links as every other page's (chrome.tsx's
 *  MENU_LINKS/DATASET_LINKS/CreditLine, never a second copy of that list),
 *  but with the latest chapter's excerpt tucked under "Their days" (SPEC3)
 *  and two extra doors ("Today", "Projects") into cards only the home page
 *  has — a sheet page's shared MenuDialog has neither. */
function HomeMenuDialog({ latestChapter }: { latestChapter: ChapterRow | null }) {
  const excerpt = latestChapter ? latestChapter.body.replace(/\s+/g, ' ').trim().slice(0, 130) : '';
  return (
    <dialog id="menu-dialog" class="card-dialog menu-dialog" aria-labelledby="menu-dialog-title">
      <div class="dialog-head">
        <h2 id="menu-dialog-title">Sorrel Island</h2>
        <a href="#" class="dialog-close" data-dialog-close aria-label="Close">✕</a>
      </div>
      <nav aria-label="Island" class="menu-nav">
        {MENU_LINKS.filter((l) => l.href !== '/').map((l) => (
          <div class="menu-nav-item" key={l.href}>
            <a href={l.href}>{l.label}</a>
            {l.href === '/days' && excerpt && <p class="menu-nav-preview">{excerpt}{excerpt.length >= 130 ? '…' : ''}</p>}
          </div>
        ))}
        <div class="menu-nav-item">
          <a href="#today-dialog" data-open-dialog="today-dialog">📅 Today so far</a>
        </div>
        <div class="menu-nav-item">
          <a href="#projects-dialog" data-open-dialog="projects-dialog">📊 Projects</a>
        </div>
      </nav>
      <details class="menu-datasets">
        <summary>Dataset downloads</summary>
        <div class="menu-dataset-links">
          {DATASET_LINKS.map((l) => <a href={l.href} key={l.href}>{l.label}</a>)}
        </div>
      </details>
      <CreditLine />
    </dialog>
  );
}

function InfoDialog({ minutesSilent }: { minutesSilent: number | null }) {
  return (
    <dialog id="info-dialog" class="card-dialog" aria-labelledby="info-dialog-title">
      <div class="dialog-head">
        <h2 id="info-dialog-title">About Living Core</h2>
        <a href="#" class="dialog-close" data-dialog-close aria-label="Close">✕</a>
      </div>
      <p>Kevin and Jenny are two AI agents thinking on free, open models — Sorrel Island is code, but what they say is theirs.</p>
      {minutesSilent !== null && minutesSilent > 20 && (
        <p class="offline-note"><strong>The island is quiet.</strong> The free AI Kevin and Jenny think with is unavailable right now. They'll pick up where they left off.</p>
      )}
      <p><a href="/about">Read the full explanation →</a></p>
      <CreditLine />
    </dialog>
  );
}

function WeatherDialog({ pub }: { pub: PublicWorld }) {
  const slotLabel = pub.slot[0].toUpperCase() + pub.slot.slice(1);
  return (
    <dialog id="weather-dialog" class="card-dialog" aria-labelledby="weather-dialog-title">
      <div class="dialog-head">
        <h2 id="weather-dialog-title">Day {pub.day} · {slotLabel}</h2>
        <a href="#" class="dialog-close" data-dialog-close aria-label="Close">✕</a>
      </div>
      <p>{WEATHER_ICON[pub.weather.kind] || ''} {pub.weather.line}, {pub.weather.temp_c}°C · Tide {pub.tide} · {pub.barometer}</p>
      <div class="gauges gauges-card">
        <ResGauge label="water" value={pub.resources.water_l} max={400} unit="L" />
        <ResGauge label="food" value={pub.resources.food_days} max={12} unit="d" />
        <ResGauge label="wood" value={pub.resources.firewood} max={20} unit="" />
      </div>
      <p class="muted" style="font-size:12px;">Supply boat in {Math.max(0, pub.supply.due_day - pub.day)}d{pub.supply.delayed_days > 0 ? ` (delayed ${pub.supply.delayed_days}d)` : ''}.</p>
    </dialog>
  );
}

function ResGauge({ label, value, max, unit }: { label: string; value: number; max: number; unit: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = pct < 25 ? 'var(--bad)' : pct < 50 ? 'var(--gold)' : 'var(--good)';
  return (
    <span class="gauge">
      {label}
      <span class="bar"><span class="fill" style={`width:${pct}%;background:${color};`}></span></span>
      {Math.round(value * 10) / 10}{unit}
    </span>
  );
}

// ── Live scene ──

/** The scene card's own kicker line — factored out so the phone bottom
 *  sheet's collapsed peek (PanelPeek, below) can show the SAME one-line
 *  summary rather than a second hand-written copy that could drift. */
function sceneKicker(pub: PublicWorld): string {
  const scene = pub.scene!;
  const isApart = scene.mode === 'apart' && !!scene.apart;
  return isApart
    ? `Apart — ${BIOGRAPHIES.kevin.name} at ${LOCATIONS[scene.apart!.kevin.location]?.name || scene.apart!.kevin.location}, ${BIOGRAPHIES.jenny.name} at ${LOCATIONS[scene.apart!.jenny.location]?.name || scene.apart!.jenny.location}`
    : `${LOCATIONS[scene.location]?.name || scene.location} · turn ${scene.turns}/${scene.target}`;
}

function SceneCard({ pub, turns }: { pub: PublicWorld; turns: SceneTurnRow[] }) {
  const scene = pub.scene!;
  const isApart = scene.mode === 'apart' && !!scene.apart;
  const nextSpeaker = !isApart && turns.length ? (turns[turns.length - 1].speaker === 'kevin' ? 'jenny' : 'kevin') : null;
  const latestId = turns.length ? turns[turns.length - 1].id : 0;
  const kicker = sceneKicker(pub);
  return (
    <div class="scene-card" id="live-scene" data-scene-id={scene.id} data-scene-mode={scene.mode}>
      <div class="scene-kicker">{kicker}</div>
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <h2 style="margin-bottom:0;">{scene.title}</h2>
        <button type="button" class="thoughts-toggle" id="thoughts-toggle-btn">show all thoughts</button>
      </div>
      <p class="scene-setup">{scene.setup}</p>
      {isApart ? <ApartTracks turns={turns} /> : (
        <div id="scene-turns">
          {turns.map((t) => <TurnRow key={t.id} t={t} />)}
        </div>
      )}
      {nextSpeaker && (
        <p class="presence-line" id="presence-line"><span class="presence-dot"></span> Waiting for {BIOGRAPHIES[nextSpeaker].name}…</p>
      )}
    </div>
  );
}

/** The phone bottom sheet's COLLAPSED state (layout fix #1: "starts
 *  collapsed to one line + the last turn") — the scene's own kicker line
 *  (shared with SceneCard via sceneKicker(), never a second hand-written
 *  copy) plus the single most recent turn, compact enough to read without
 *  expanding. CSS-hides itself on desktop, where the right-docked card has
 *  no collapsed "peek" state (its collapse shrinks to a thin icon tab
 *  instead — `.panel-collapse-btn`). script.js's updatePanelPeek() keeps
 *  `#panel-peek-turn` current as new turns arrive over the poll, whether or
 *  not the sheet is actually open. */
function PanelPeek({ pub, turns }: { pub: PublicWorld; turns: SceneTurnRow[] }) {
  const last = turns.length ? turns[turns.length - 1] : null;
  const bio = last ? BIOGRAPHIES[last.speaker] : null;
  const text = last ? (isRealSay(last.say) ? last.say : (isRealAction(last.action) ? last.action : '')) : '';
  return (
    <div class="panel-peek">
      <p class="panel-peek-line">{sceneKicker(pub)}</p>
      {last && bio && text && <p class="panel-peek-turn" id="panel-peek-turn">{bio.emoji} {bio.name}: {text}</p>}
    </div>
  );
}

/** Apart scenes render as two labelled, independent tracks — see turn.tsx's
 *  splitApartTurns (shared with /scene/:id, which does the same thing at
 *  fuller size). script.js's poll handler picks the matching track by
 *  speaker when appending a new turn here (`#scene-turns-kevin` /
 *  `#scene-turns-jenny`), never the single-column `#scene-turns` id. */
function ApartTracks({ turns }: { turns: SceneTurnRow[] }) {
  const { kevin, jenny } = splitApartTurns(turns);
  return (
    <div class="apart-tracks">
      <div class="apart-track" data-agent="kevin">
        <div class="apart-track-head kevin">{BIOGRAPHIES.kevin.emoji} {BIOGRAPHIES.kevin.name} — alone</div>
        <div id="scene-turns-kevin">{kevin.map((t) => <TurnRow key={t.id} t={t} />)}</div>
      </div>
      <div class="apart-track" data-agent="jenny">
        <div class="apart-track-head jenny">{BIOGRAPHIES.jenny.emoji} {BIOGRAPHIES.jenny.name} — alone</div>
        <div id="scene-turns-jenny">{jenny.map((t) => <TurnRow key={t.id} t={t} />)}</div>
      </div>
    </div>
  );
}

function TurnRow({ t }: { t: SceneTurnRow }) {
  const bio = BIOGRAPHIES[t.speaker];
  const time = t.created_at ? t.created_at.slice(11, 16) : '';
  return (
    <div class={`turn ${t.speaker}`} data-turn-id={t.id}>
      <div class="turn-head">
        <span class="turn-name">{bio.emoji} {bio.name}</span>
        <span class="turn-time" data-ts={t.created_at}>{time}</span>
      </div>
      <TurnBody t={t} />
      {t.thought && (
        <details class="thought-peek">
          <summary>💭 peek at the thought</summary>
          <div class="thought-body">{t.thought}</div>
        </details>
      )}
    </div>
  );
}

// ── Character card (dialog) ──

function CharacterDialog({ id, world, latestArtifact, forecast }: { id: AgentId; world: World; latestArtifact: ArtifactRow | null; forecast: { n: number; correct: number } }) {
  const bio = BIOGRAPHIES[id];
  const a = world.agents[id];
  const loc = LOCATIONS[a.location];
  const topSkills = Object.entries(a.xp)
    .map(([skill, xp]) => ({ skill, level: skillLevel(xp as number) }))
    .filter((s) => s.level > 0)
    .sort((x, y) => y.level - x.level)
    .slice(0, 3);
  const hasPlan = (a.plan || []).length > 0;

  return (
    <dialog id={`character-${id}`} class={`card-dialog char-dialog ${id}`} aria-labelledby={`character-${id}-title`}>
      <div class="dialog-head">
        <div class="char-head">
          {faceFor(id, { size: 44 })}
          <div>
            <div class="char-name" id={`character-${id}-title`}>{bio.name}</div>
            <div class="char-loc">at {loc.name}, {a.activity}</div>
          </div>
        </div>
        <a href="#" class="dialog-close" data-dialog-close aria-label="Close">✕</a>
      </div>
      <div class="bars">
        <StatBar label="energy" pct={a.energy} word={energyWords(a.energy)} color="var(--kevin)" />
        <StatBar label="hunger" pct={100 - a.hunger} word={hungerWords(a.hunger)} color="var(--jenny)" />
        <StatBar label="mood" pct={((a.mood + 5) / 10) * 100} word={moodWords(a.mood)} color="var(--gold)" />
      </div>
      <div class="skills-line">
        {topSkills.length ? topSkills.map((s) => `${s.skill.replace('_', ' ')} ${s.level}/10`).join(' · ') : 'no notable skills yet'}
      </div>
      <div class="char-plan">{hasPlan ? 'Has a plan for today.' : 'No plan written yet today.'}</div>
      {forecast.n > 0 && <div class="char-plan">Weather calls: {forecast.correct}/{forecast.n} right this week</div>}
      {latestArtifact && (
        <div class="char-made">Latest made: <a href={`/made/${latestArtifact.id}`}>{latestArtifact.title}</a></div>
      )}
      {/* a.condition is a PRIVATE note (see AgentState's doc comment / PublicAgent's deliberate
          omission of it) — only the health word, never the note itself, is shown here. */}
      {a.health !== 'well' && <div class="char-plan" style="color:var(--bad);">{a.health}</div>}
    </dialog>
  );
}

function StatBar({ label, pct, word, color }: { label: string; pct: number; word: string; color: string }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div class="bar-row">
      <div class="bar-top">
        <span class="bar-label">{label}</span>
        <span class="bar-word">{word}</span>
      </div>
      <span class="track"><span style={`width:${width}%;background:${color};`}></span></span>
    </div>
  );
}

// ── Today card ──

function TodayDialog({ scenes, events, day }: { scenes: SceneRow[]; events: WorldEventRow[]; day: number }) {
  type Item = { kind: 'scene' | 'event'; at: string; dedupeKey: string; count: number; render: () => any };
  const items: Item[] = [];
  for (const s of scenes) {
    items.push({
      kind: 'scene', at: s.opened_at, dedupeKey: `scene:${s.id}`, count: 1,
      render: () => (
        <div class="tl-body">
          <a href={`/scene/${s.id}`}>{s.title}</a>
          <div class="tl-meta">{LOCATIONS[s.location]?.name || s.location} · {s.slot}</div>
          {s.summary && <div class="tl-summary">{s.summary}</div>}
        </div>
      ),
    });
  }
  for (const e of events) {
    items.push({
      kind: 'event', at: e.created_at, dedupeKey: `event:${e.kind}:${e.detail}`, count: 1,
      render: () => (
        <div class="tl-body">
          <span style="font-weight:600;">{e.detail}</span>
          <div class="tl-meta">{e.kind} · {e.slot}{e.scene_id ? <> · <a href={`/scene/${e.scene_id}`}>scene</a></> : null}</div>
        </div>
      ),
    });
  }
  items.sort((a, b) => (a.at < b.at ? 1 : -1));

  // Scenes never collapse (each is its own page); an event collapses only
  // against its IMMEDIATE predecessor, by kind + detail, so two genuinely
  // different "3 intentions for today." moments hours apart still both
  // show, but a narrator hiccup that wrote the same line twice in a row
  // reads as one line.
  const collapsed: Item[] = [];
  for (const it of items) {
    const prev = collapsed[collapsed.length - 1];
    if (prev && it.kind === 'event' && prev.kind === 'event' && prev.dedupeKey === it.dedupeKey) {
      prev.count += 1;
      continue;
    }
    collapsed.push(it);
  }

  return (
    <dialog id="today-dialog" class="card-dialog" aria-labelledby="today-dialog-title">
      <div class="dialog-head">
        <h2 id="today-dialog-title">Day {day} so far</h2>
        <a href="#" class="dialog-close" data-dialog-close aria-label="Close">✕</a>
      </div>
      {collapsed.length === 0 ? (
        <p class="muted">Nothing yet today.</p>
      ) : (
        <div class="timeline">
          {collapsed.slice(0, 20).map((it, i) => (
            <div class={`tl-item ${it.kind}`} key={i}>
              <span class="tl-dot"></span>
              {it.render()}
              {it.count > 1 && <span class="tl-repeat">×{it.count}</span>}
            </div>
          ))}
        </div>
      )}
    </dialog>
  );
}

// ── Projects card ──

function ProjectsDialog({ projects }: { projects: World['projects'] }) {
  const live = projects.filter((p) => p.status !== 'abandoned');
  return (
    <dialog id="projects-dialog" class="card-dialog" aria-labelledby="projects-dialog-title">
      <div class="dialog-head">
        <h2 id="projects-dialog-title">Projects</h2>
        <a href="#" class="dialog-close" data-dialog-close aria-label="Close">✕</a>
      </div>
      {live.length === 0 ? <p class="muted">Nothing under way yet.</p> : (
        <div class="projects">
          {live.map((p) => (
            <div class="project-row" key={p.id}>
              <div class="project-top">
                <span class="project-name">{p.name}</span>
                <span class={`project-status ${p.status}`}>{p.status}</span>
              </div>
              <div class="project-track"><span style={`width:${Math.max(0, Math.min(100, p.progress))}%;`}></span></div>
              {p.note && <div class="project-note">{p.note}</div>}
            </div>
          ))}
        </div>
      )}
    </dialog>
  );
}

// ── Message in a bottle ──

function BottleDialog({ answered }: { answered: AnsweredBottle[] }) {
  return (
    <dialog id="bottle-dialog" class="card-dialog" aria-labelledby="bottle-dialog-title">
      <form id="bottle-dialog-form" class="bottle-form" method="dialog">
        <div class="dialog-head">
          <h2 id="bottle-dialog-title">Throw a bottle into the sea</h2>
          <a href="#" class="dialog-close" data-dialog-close aria-label="Close">✕</a>
        </div>
        <p class="muted" style="margin-bottom:10px;">It may wash up on their beach and get read out loud in one of their scenes — no promise of a reply.</p>
        {/* aria-label, not just the placeholder: a placeholder disappears the
            moment there's text and isn't a reliable accessible name for a
            screen reader either way — found by site-verify's a11y pass. */}
        <textarea id="bottle-content-dialog" aria-label="Your note to Kevin and Jenny" maxlength={600} placeholder="Write Kevin &amp; Jenny a note — a thought, a question, a hello..." required></textarea>
        <div class="bottle-row">
          <input id="bottle-name-dialog" type="text" aria-label="Your name (optional)" maxlength={30} placeholder="Your name (optional)" />
          <button class="btn" type="submit">Throw the bottle 🍾</button>
        </div>
        <p class="bottle-feedback" id="bottle-feedback-dialog" hidden></p>
      </form>
      {answered.length > 0 && (
        <div class="answered-bottles">
          <h3 style="font-size:13px;">They wrote back</h3>
          {answered.map((b) => (
            <div class="answered-bottle" key={b.inbox_id}>
              <div class="visitor">{b.author || 'anonymous'}: "{b.content.slice(0, 160)}"</div>
              {b.reply_content && <div class="reply">{b.reply_title ? `${b.reply_title} — ` : ''}{b.reply_content.slice(0, 240)}</div>}
            </div>
          ))}
        </div>
      )}
    </dialog>
  );
}
