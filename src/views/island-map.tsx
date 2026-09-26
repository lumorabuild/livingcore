/** @jsxImportSource hono/jsx */
// ─────────────────────────────────────────────────────────────────────────────
// THE ISLAND MAP — one hand-illustrated inline SVG, 1000×640, using LOCATIONS'
// own x/y (src/world/bio.ts) so a location here is the SAME point the
// narrator and the client script move pins to. Sky/weather are driven by CSS
// (see public/app.css's [data-slot]/[data-weather] rules) via attributes this
// component sets on the wrapper — no per-slot SVG variants to keep in sync.
//
// Part 2 (SPEC2.md §B) turned this from a pin board into the full-screen home
// page: the scenery pieces below now double as DOORS (wrapped in <a>, see
// Landmark()) and Kevin/Jenny are small posed figures instead of dot tokens,
// with their pose driven entirely by CSS attribute selectors on `data-activity`
// — see Figure()'s header comment for why that split matters for the live
// poll (no SVG re-render needed to change what someone is doing).
//
// Instead of generic emoji badges, each discovered place is drawn as small
// scenery (trees, a garden wall, a dock, a lighthouse…) so the island reads
// as a real place rather than a pin board. A soft, blurred "?" fog blob
// stands in for anywhere undiscovered — its true shape is never revealed
// early. Kevin and Jenny are drawn as coloured figures that live INSIDE the
// same <g> the client script moves, so a live pin update carries their pose
// and bob animation along with it for free.
//
// All scattered scenery (tree crowns, reef rubble…) is generated from a tiny
// seeded PRNG, never Math.random() — the same world state must always render
// the same SVG, request to request.
// ─────────────────────────────────────────────────────────────────────────────

import { safeJson } from './safe-json';
import type { Activity, AgentId, LocationId } from '../world/types';
import type { PublicAgent, PublicWorld } from '../world/tick';
import { LOCATIONS } from '../world/bio';
import { BIOGRAPHIES } from '../world/bio';

// ── tiny deterministic PRNG (mulberry32) — same seed, same scatter, always ──
function rngFor(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Catmull-Rom → cubic Bezier for a CLOSED loop of points — turns a rough ring
 *  of anchor points into a smooth, organic coastline with no manual tangents. */
export function smoothClosedPath(points: [number, number][]): string {
  const n = points.length;
  if (n < 3) return '';
  const at = (i: number) => points[((i % n) + n) % n];
  let d = `M ${at(0)[0]} ${at(0)[1]} `;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const b1x = p1[0] + (p2[0] - p0[0]) / 6;
    const b1y = p1[1] + (p2[1] - p0[1]) / 6;
    const b2x = p2[0] - (p3[0] - p1[0]) / 6;
    const b2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C ${b1x} ${b1y}, ${b2x} ${b2y}, ${p2[0]} ${p2[1]} `;
  }
  return d + 'Z';
}

function centroidOf(points: [number, number][]): [number, number] {
  let cx = 0, cy = 0;
  for (const [x, y] of points) { cx += x; cy += y; }
  return [cx / points.length, cy / points.length];
}

/** Scales a ring of points outward/inward from its own centroid — used to
 *  build the sand rim (a bit bigger than the coastline) and the reef ring
 *  (bigger still) from ONE hand-picked anchor ring, so the three bands can
 *  never drift out of sync with each other. */
function scaleRing(points: [number, number][], factor: number): [number, number][] {
  const [cx, cy] = centroidOf(points);
  return points.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor] as [number, number]);
}

// Rough coastline anchor ring — hand-picked so it comfortably encloses every
// interior LOCATIONS point (with real margin around the lighthouse/cliffs in
// the north-east and the cave on the west shore) while the reef, the wreck
// and the hidden cove sit just outside it, the way a real fringing-reef
// island would.
export const COASTLINE: [number, number][] = [
  [470, 80], [600, 68], [705, 88], [790, 148], [832, 228],
  [822, 320], [792, 408], [808, 478], [732, 544], [652, 586],
  [542, 612], [440, 596], [350, 560], [270, 510], [206, 440],
  [190, 352], [210, 260], [260, 190], [330, 140], [400, 100],
];

// Exported (with smoothClosedPath below) so src/views/chrome.tsx's SheetBackdrop
// can draw the SAME coastline, softened and blurred, behind every non-map
// page — one silhouette, never two hand-maintained copies of the same island.
export const SAND_RIM = scaleRing(COASTLINE, 1.045);
const REEF_RING = scaleRing(COASTLINE, 1.16);
const SHALLOWS = scaleRing(COASTLINE, 1.09);

const REEF_WRECK: [number, number][] = [
  [150, 500], [195, 478], [212, 528], [178, 556], [132, 542],
];

// A tiny separate islet for the hidden cove — deliberately NOT drawn until
// discovered, and even then it sits just outside the main coastline, exactly
// as invisible-from-land as bio.ts's hiddenHint describes.
const COVE_ISLET: [number, number][] = [
  [812, 300], [852, 288], [878, 320], [860, 358], [822, 350], [800, 322],
];

function toPath(points: [number, number][]) {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z';
}

/** Short, non-overlapping hand-lettered labels — LOCATIONS' own `name` is
 *  often a whole descriptive phrase ("the keeper's cottage"), too long to
 *  set in a script face at this scale. */
const SHORT_LABEL: Record<LocationId, string> = {
  cottage: 'the cottage', garden: 'the garden', dock: 'the dock', beach: 'south beach',
  tidepools: 'tide pools', woods: 'the woods', spring: 'the spring', hilltop: 'hilltop',
  cliffs: 'north cliffs', lighthouse: 'lighthouse', cave: 'sea cave', wreck: 'the wreck', cove: 'hidden cove',
  // Patrons (spec §A2): fogged like cave/wreck/cove until the first gift arrives.
  shrine: 'the shrine',
};

function findProjectProgress(projects: PublicWorld['projects'], needle: string): number | null {
  const p = projects.find((p) => p.name.toLowerCase().includes(needle));
  return p ? Math.max(0, Math.min(100, p.progress)) : null;
}

// ── walking waypoints, exported for the client's tween (part 2 spec §B) ──
//
// A real path graph for 13 locations is overkill for what this needs to do
// (stop a straight line from cutting across open sea); one central hub near
// the cottage/garden path junction, plus a single "bend" point for the
// handful of locations a straight hub-line would otherwise cut a corner
// through (the north side past the cliffs/lighthouse, the west shore past
// the cave/wreck), is enough. script.js builds a walk as
// [from, from.bend||hub, to.bend||hub, to] and drops repeated points.
export interface WalkPoint { x: number; y: number }
export const WALK_HUB: WalkPoint = { x: 520, y: 430 };
export const WALK_BENDS: Partial<Record<LocationId, WalkPoint>> = {
  cliffs: { x: 560, y: 200 }, lighthouse: { x: 650, y: 190 }, cove: { x: 735, y: 255 },
  cave: { x: 300, y: 400 }, wreck: { x: 260, y: 470 }, spring: { x: 420, y: 300 }, hilltop: { x: 480, y: 260 },
};

export function walkGraphJson(): string {
  return safeJson({ hub: WALK_HUB, bends: WALK_BENDS });
}

/** Location coordinates for the client script (public JSON, no secrets) — lets
 *  script.js move a pin to a new location after a poll without re-rendering
 *  the whole map. */
export function locationCoordsJson(): string {
  const out: Record<string, { x: number; y: number }> = {};
  for (const id of Object.keys(LOCATIONS) as LocationId[]) out[id] = { x: LOCATIONS[id].x, y: LOCATIONS[id].y };
  return safeJson(out);
}

// ── landmark cards' data (SPEC3 §"Landmarks") ──
//
// ONE small record per clickable spot on the island — real LocationIds plus
// two synthetic keys for structures that aren't a place anyone stands in
// (the workshop shed, the dock's signpost). script.js reads this (embedded
// as JSON, same pattern as locationCoordsJson above) and fills ONE reusable
// dialog from it on every landmark click — 20 bespoke dialogs would drift;
// one lookup table cannot.
export interface LocationInfoEntry {
  name: string;
  /** A short, compact form of `name` (SHORT_LABEL/SHORT_LABEL_OVERRIDE, above)
   *  — e.g. "the dock" rather than LOCATIONS' full "the dock" already-short
   *  name, or "the cottage" rather than "the keeper's cottage". Added for the
   *  HUD "now" chips and the map caption card (HomePage.tsx), which both need
   *  a terse place word and must agree with each other and with
   *  public/script.js's own copy of it (LOCINFO ships this same field). */
  short: string;
  /** What a visitor sees there right now — LOCATIONS' own description for a
   *  plain spot, or "Kevin is here, fishing." for an occupied one. */
  blurb: string;
  href?: string;
  hrefLabel?: string;
  /** A second, smaller link inside the card — e.g. the cottage/garden's
   *  "see the projects" (SPEC3: reachable "from the menu and from the
   *  cottage/garden"), which is not the card's own primary door. */
  extra?: { href: string; label: string }[];
}

const DOOR: Partial<Record<string, { href: string; hrefLabel: string }>> = {
  cottage: { href: '/days', hrefLabel: 'Read their days' },
  workshop: { href: '/workshop', hrefLabel: 'See what they made' },
  hilltop: { href: '/notebook', hrefLabel: "See what they've learned" },
  lighthouse: { href: '/lab', hrefLabel: 'Open the Lab' },
  wreck: { href: '/archive', hrefLabel: 'The talking-era archive' },
  chest: { href: '/archive', hrefLabel: 'The talking-era archive' },
  signpost: { href: '/about', hrefLabel: 'About this experiment' },
  // Patrons (spec §A2): revealed the moment the first gift crate arrives.
  shrine: { href: '/shrine', hrefLabel: 'Visit the shrine' },
};

const STATIC_BLURB: Record<string, string> = {
  workshop: "A small shed beside the cottage, where things get made.",
  signpost: 'A hand-carved signpost at the dock, pointing back to why any of this exists.',
  chest: 'An old sea chest, washed up and half-buried — a door into the archive, until the real wreck is found.',
  'hilltop-open': "Bare grass and the island's best view. The cairn at the peak is its own door.",
};

/** Who (if anyone) is at a real LocationId right now, in one short clause —
 *  "Kevin is here, fishing." / "Kevin and Jenny are both here." / ''. */
function occupantLine(id: LocationId, world: PublicWorld): string {
  const here: string[] = [];
  for (const agentId of ['kevin', 'jenny'] as const) {
    const a = world.agents[agentId];
    if (a.location === id) here.push(`${BIOGRAPHIES[agentId].name} (${a.activity})`);
  }
  if (here.length === 2) return `${BIOGRAPHIES.kevin.name} and ${BIOGRAPHIES.jenny.name} are both here.`;
  if (here.length === 1) return `${here[0]} is here.`;
  return 'Nobody is here right now.';
}

export function buildLocationInfo(world: PublicWorld): Record<string, LocationInfoEntry> {
  const out: Record<string, LocationInfoEntry> = {};
  for (const id of Object.keys(LOCATIONS) as LocationId[]) {
    const loc = LOCATIONS[id];
    const door = DOOR[id];
    out[id] = {
      name: loc.name,
      short: SHORT_LABEL[id] || loc.name,
      blurb: `${occupantLine(id, world)} ${loc.description}`.trim(),
      href: door?.href,
      hrefLabel: door?.hrefLabel,
    };
  }
  // Synthetic, non-location doors — same DOOR table, a static one-liner
  // instead of live occupants (nobody visibly "stands" in a signpost).
  for (const key of ['workshop', 'signpost', 'chest', 'hilltop-open']) {
    const door = DOOR[key];
    const short = SHORT_LABEL_OVERRIDE[key] || key;
    out[key] = { name: short, short, blurb: STATIC_BLURB[key] || '', href: door?.href, hrefLabel: door?.hrefLabel };
  }
  // The cottage and garden are also the way to the projects card (SPEC3);
  // the projects board itself lives in HomePage.tsx's own dialog markup, so
  // this only ever links to its id, never duplicates its content.
  if (out.cottage) out.cottage.extra = [{ href: '#projects-dialog', label: 'See the projects' }];
  if (out.garden) out.garden.extra = [{ href: '#projects-dialog', label: 'See the projects' }];
  // Patrons (spec §A2): the dock is where the supply boat and every crate
  // tie up — the natural place to point at the shop, never a second door.
  if (out.dock) out.dock.extra = [{ href: '/shop', label: 'Send them a crate →' }];
  // The lighthouse's card also carries the Lab's own headline numbers
  // (SPEC3: "the Lab strip numbers inside the lighthouse card") — appended
  // by HomePage.tsx, which is the only page that has computed them; this
  // function has no metrics access on purpose (world/metrics.ts is a DB
  // read, and this is a pure render-time helper).
  return out;
}

const SHORT_LABEL_OVERRIDE: Record<string, string> = {
  workshop: 'The workshop shed', signpost: 'The signpost', chest: 'A sea chest', 'hilltop-open': 'The hilltop',
};

export function locationInfoJson(world: PublicWorld): string {
  return safeJson(buildLocationInfo(world));
}

// ── agents: small posed figures ──

/**
 * Where a figure stands, nudged from the location's own x/y so the pose
 * reads (rod out over water at the dock, axe-arm toward the woods…) and so
 * two figures doing different things at the same place don't stand on each
 * other. Deliberately activity-keyed rather than activity+location-keyed —
 * a real per-location table would be 13×18 entries for a cosmetic nudge;
 * this gets 90% of the effect at 10% of the size, and SHARED (see `dx` in
 * Figure()) already guarantees the two of them never fully overlap.
 *
 * MIRRORED in public/script.js (ACTIVITY_OFFSET) — same pattern as
 * src/world/activity.ts's own header note: keep the two in sync by hand.
 */
export const ACTIVITY_OFFSET: Partial<Record<Activity, [number, number]>> = {
  fishing: [10, -2], chopping: [-8, 6], gardening: [6, -6], sketching: [10, -10],
  repairing: [-10, -8], building: [8, -10], foraging: [-8, 8], swimming: [14, 18],
  radio: [12, -12], writing: [-12, -12], exploring: [8, -12], resting: [0, 6],
  cooking: [-8, -12], eating: [8, -12],
};

/** Which prop (if any) a pose shows, and where it rides — see Figure(). */
const PROP_BY_ACTIVITY: Partial<Record<Activity, string>> = {
  fishing: 'rod', chopping: 'axe', gardening: 'hoe', sketching: 'book', writing: 'book',
  repairing: 'hammer', building: 'hammer', exploring: 'spyglass', radio: 'radio', swimming: 'ripple',
};

/** One posed figure. Body parts and every prop are ALWAYS in the markup;
 *  which ones show, and how the arms/legs move, is decided entirely by CSS
 *  attribute selectors on `data-activity` (public/app.css's "poses" block).
 *  That is deliberate: the live poll changes an agent's activity every few
 *  seconds and must never require re-rendering this SVG fragment — script.js
 *  only ever does `pin.setAttribute('data-activity', …)`. Coordinates are
 *  local to the figure's own origin (0,0 = feet, facing forward/right); the
 *  outer <g> (see AgentFigure below) carries the actual map position. */
function Figure({ id }: { id: AgentId }) {
  const bio = BIOGRAPHIES[id];
  return (
    <g class="figure-parts">
      {/* The "who's narrating right now" ring — subtitles rewrite (see
          HomePage.tsx's caption card). script.js sets `data-active` on the
          parent `.pin` for exactly as long as this figure's turn is the one
          showing in the caption card; app.css's `.pin[data-active] .fig-active-ring`
          fades it in and pulses it gently. Always in the markup (same "pose
          via attribute, never re-render" rule as every prop below), fill:none
          so it never eats a click, drawn BEFORE the body so it reads as a
          ring around the figure rather than over it. */}
      <circle class="fig-active-ring" cx="0" cy="-13" r="21" fill="none" stroke={bio.color} stroke-width="2" />
      <ellipse class="fig-shadow" cx="0" cy="1.5" rx="10" ry="2.6" fill="#0a0705" opacity="0.24" />

      {/* Zzz — shown only in place of the body when data-activity="sleeping" */}
      <g class="fig-zzz" aria-hidden="true">
        <text class="zzz z1" x="4" y="-30" font-family="var(--font-hand)" font-weight="700" font-size="11" fill={bio.color}>z</text>
        <text class="zzz z2" x="10" y="-38" font-family="var(--font-hand)" font-weight="700" font-size="8.5" fill={bio.color}>z</text>
        <text class="zzz z3" x="15" y="-45" font-family="var(--font-hand)" font-weight="700" font-size="6.5" fill={bio.color}>z</text>
      </g>

      <g class="fig-body">
        <path class="fig-leg fig-leg-l" d="M -1.8 -12 L -5 0" fill="none" stroke={bio.color} stroke-width="3.4" stroke-linecap="round" />
        <path class="fig-leg fig-leg-r" d="M 1.8 -12 L 5 0" fill="none" stroke={bio.color} stroke-width="3.4" stroke-linecap="round" />
        <rect class="fig-torso" x="-4.6" y="-23" width="9.2" height="12.5" rx="4.4" fill={bio.color} stroke="#fffdf6" stroke-width="1.3" />
        <g class="fig-arm fig-arm-l">
          <path d="M -3.6 -20.5 L -8.5 -9.5" fill="none" stroke={bio.color} stroke-width="2.8" stroke-linecap="round" />
          <g class="fig-hand-l" transform="translate(-8.5, -9.5)">
            <rect class="prop prop-book" x="-6" y="-1.5" width="8" height="6" rx="0.8" fill="#e4d9bf" stroke="#8a7159" stroke-width="0.8" transform="rotate(-8)" />
          </g>
        </g>
        <g class="fig-arm fig-arm-r">
          <path d="M 3.6 -20.5 L 8.5 -9.5" fill="none" stroke={bio.color} stroke-width="2.8" stroke-linecap="round" />
          <g class="fig-hand-r" transform="translate(8.5, -9.5)">
            <g class="prop prop-rod">
              <line x1="0" y1="0" x2="16" y2="-14" stroke="#6b5133" stroke-width="1.3" stroke-linecap="round" />
              <line x1="16" y1="-14" x2="19" y2="4" stroke="#c9bea3" stroke-width="0.7" />
              <circle class="rod-float" cx="19" cy="4" r="1.6" fill="#ff6b3d" />
            </g>
            <g class="prop prop-axe">
              <line x1="0" y1="0" x2="7" y2="-9" stroke="#6b5133" stroke-width="2" stroke-linecap="round" />
              <path d="M 7 -9 L 13 -13 L 13 -5 Z" fill="#8a8378" />
              <path class="chip chip-1" d="M 13 -6 l 3 -1 l -1 3 z" fill="#b98a4a" />
              <path class="chip chip-2" d="M 12 -9 l 3 0 l -2 3 z" fill="#b98a4a" />
            </g>
            <g class="prop prop-hoe">
              <line x1="0" y1="0" x2="9" y2="-12" stroke="#6b5133" stroke-width="1.8" stroke-linecap="round" />
              <line x1="6.5" y1="-9.5" x2="11.5" y2="-8" stroke="#5a5548" stroke-width="2" stroke-linecap="round" />
            </g>
            <g class="prop prop-hammer">
              <line x1="0" y1="0" x2="6" y2="-8" stroke="#6b5133" stroke-width="2" stroke-linecap="round" />
              <rect x="4.5" y="-11.5" width="6" height="4" rx="1" fill="#8a8378" />
              <line class="spark spark-1" x1="10" y1="-9" x2="13" y2="-11" stroke="#ffd27a" stroke-width="1" />
              <line class="spark spark-2" x1="10" y1="-8" x2="13" y2="-7" stroke="#ffd27a" stroke-width="1" />
            </g>
            <g class="prop prop-spyglass">
              <path d="M 0 0 L 9 -6" stroke="#8a7159" stroke-width="2.4" stroke-linecap="round" />
              <circle cx="9" cy="-6" r="1.6" fill="none" stroke="#c9bea3" stroke-width="0.8" />
            </g>
          </g>
        </g>
        <circle class="fig-head" cx="0" cy="-27" r="5.6" fill={bio.color} stroke="#fffdf6" stroke-width="1.6" />
      </g>

      <g class="prop prop-radio" transform="translate(-13, -8)">
        <rect x="-3.5" y="-3" width="7" height="6" rx="1" fill="#5a5548" stroke="#3c3322" stroke-width="0.6" />
        <line x1="2" y1="-3" x2="4" y2="-9" stroke="#3c3322" stroke-width="0.8" />
        <path class="radio-wave w1" d="M 6 -4 q 3 -1 3 -4" fill="none" stroke="#c9bea3" stroke-width="0.8" stroke-linecap="round" />
        <path class="radio-wave w2" d="M 7 -3 q 5 -2 5 -7" fill="none" stroke="#c9bea3" stroke-width="0.7" stroke-linecap="round" />
      </g>

      <g class="prop prop-ripple" transform="translate(0, 2)">
        <ellipse class="ripple ripple-1" cx="0" cy="0" rx="9" ry="2.4" fill="none" stroke="var(--sea-2)" stroke-width="1" />
        <ellipse class="ripple ripple-2" cx="0" cy="0" rx="9" ry="2.4" fill="none" stroke="var(--sea-2)" stroke-width="1" />
      </g>

      <g transform="translate(0, 12)" class="fig-nameplate">
        <rect x={-(bio.name.length * 3.4 + 8) / 2} y="-9.5" width={bio.name.length * 3.4 + 8} height="14" rx="7" fill="#171208" fill-opacity="0.72" />
        <text x="0" y="0.5" text-anchor="middle" font-size="10.5" font-weight="700" fill="#fffdf6" class="hand-label">{bio.name}</text>
      </g>
    </g>
  );
}

function AgentFigure({ id, a, shared }: { id: AgentId; a: PublicAgent; shared: boolean }) {
  const loc = LOCATIONS[a.location];
  const dx = shared ? (id === 'kevin' ? -22 : 22) : 0;
  const [ox, oy] = ACTIVITY_OFFSET[a.activity] || [0, 0];
  return (
    // Positioning lives on THIS outer <g> as a plain SVG `transform` attribute
    // — the one script.js rewrites after a poll (both the base translate AND
    // a mid-walk tween use this same attribute, never a CSS transform). The
    // bob animation lives on an INNER <g> with its own (unattributed) CSS
    // `transform`, deliberately kept apart: a CSS `transform` on an element
    // that also carries a `transform` attribute REPLACES the attribute
    // outright (SVG2/CSS Transforms), so a bob animation on this same node
    // would have collapsed every agent to translateY(0±3) — i.e. the map's
    // origin corner. That was the "pin clipped at the top-left corner" bug.
    <g class="pin" transform={`translate(${loc.x + dx + ox}, ${loc.y + oy})`} data-agent={id} data-loc={a.location} data-activity={a.activity}>
      <g class="pin-bob">
        {/* A minimum on-screen size, independent of both the bob animation
            above (a CSS `transform`, composes fine with this one since
            they're on DIFFERENT elements) and the `.pin`'s attribute
            `transform` above THAT (a CSS transform on the SAME node as an
            SVG `transform` attribute would replace it — see the header
            comment on this file; a whole extra `<g>` sidesteps that rather
            than fighting it). public/script.js writes this element's
            `style.transform: scale(...)` every time the map's pan/zoom
            scale changes, counter-scaling the figure (+ its name label,
            drawn INSIDE Figure() so it rides along for free) back up when
            zoomed out past ~34px tall (SPEC3 layout fix #3). transform-box
            keeps the scale anchored at this figure's own origin (0,0 = its
            feet, see Figure()'s header comment) so it grows/shrinks in
            place instead of drifting off its spot. */}
        <g class="pin-scale">
          {/* Clicking Kevin/Jenny opens their character card — a real fragment
              link (works with JS off, jumps to the anchor; :target then shows
              the SSR'd card CSS-only) that script.js upgrades into
              dialog.showModal(). The link wraps only the figure, never the
              whole <g>, so the walk tween's own transform (above) is untouched
              by anything link-related. */}
          <a href={`#character-${id}`} class="figure-link" aria-label={`${BIOGRAPHIES[id].name} — open their character card`} data-open-dialog={`character-${id}`}>
            <Figure id={id} />
          </a>
        </g>
      </g>
    </g>
  );
}

// ── landmarks: scenery pieces double as doors ──

/** Wraps a piece of scenery in a real, focusable link, plus an invisible
 *  larger hit-circle (small hand-drawn scenery is well under a 44px touch
 *  target at map scale) and a label that only shows on hover/focus/tap-hold
 *  (public/script.js adds the tap-hold, CSS alone covers hover/focus). The
 *  landmarks are delight; src/views/BaseLayout.tsx's nav + the HUD edge menu
 *  (HomePage.tsx) are the accessible path to the same six pages. */
/**
 * A door. Still a real `<a href>` — a no-JS visitor (or a search crawler)
 * lands straight on the linked page, exactly as before part 3. With JS,
 * public/script.js intercepts the click and shows a small LANDMARK CARD
 * first (name, one line of what's happening there, a primary button to this
 * same href) instead of navigating immediately — SPEC3 §"Landmarks". The
 * card's content comes from `buildLocationInfo()` below, keyed by
 * `landmarkKey`, never duplicated here.
 */
function Landmark({ href, label, cx, cy, hitR = 28, labelDy, landmarkKey, children }: {
  href: string; label: string; cx: number; cy: number; hitR?: number; labelDy?: number; landmarkKey: string; children: any;
}) {
  const dy = labelDy ?? -(hitR + 8);
  const w = label.length * 4.4 + 12;
  return (
    <a href={href} class="landmark" aria-label={label} data-landmark data-landmark-key={landmarkKey}>
      <circle class="landmark-glow" cx={cx} cy={cy} r={hitR * 0.85} fill="#fffdf6" opacity="0" filter="url(#landmarkGlow)" />
      {children}
      <g class="landmark-label" transform={`translate(${cx}, ${cy + dy})`}>
        <rect x={-w / 2} y="-10" width={w} height="17" rx="8.5" fill="#171208" fill-opacity="0.86" />
        <text x="0" y="1.5" text-anchor="middle" font-size="11" font-weight="700" fill="#fffdf6" class="hand-label">{label}</text>
      </g>
      <circle class="landmark-hit" cx={cx} cy={cy} r={hitR} fill="transparent" />
    </a>
  );
}

/**
 * A place with NO page of its own (garden, dock, the woods, the spring…).
 * No JS enhancement, nothing that needs enhancement — this is a real
 * `role="button"` element up front, because there is nowhere for a no-JS
 * click to land anyway; the info it reveals (who's there, what it is) is a
 * pure bonus on top of the always-visible scenery, never the only way to
 * see anything. Keyboard-operable (Enter/Space — script.js's delegated
 * handler listens for both click and keydown on `[data-landmark]`).
 */
function PlainSpot({ landmarkKey, label, cx, cy, hitR = 24 }: { landmarkKey: string; label: string; cx: number; cy: number; hitR?: number }) {
  const w = label.length * 4.4 + 12;
  return (
    <g class="landmark plain-landmark" role="button" tabindex={0} aria-label={label} data-landmark data-landmark-key={landmarkKey}>
      <circle class="landmark-glow" cx={cx} cy={cy} r={hitR * 0.85} fill="#fffdf6" opacity="0" filter="url(#landmarkGlow)" />
      <g class="landmark-label" transform={`translate(${cx}, ${cy - (hitR + 8)})`}>
        <rect x={-w / 2} y="-10" width={w} height="17" rx="8.5" fill="#171208" fill-opacity="0.86" />
        <text x="0" y="1.5" text-anchor="middle" font-size="11" font-weight="700" fill="#fffdf6" class="hand-label">{label}</text>
      </g>
      <circle class="landmark-hit" cx={cx} cy={cy} r={hitR} fill="transparent" />
    </g>
  );
}

function WoodsCluster() {
  const loc = LOCATIONS.woods;
  const rand = rngFor(4177);
  const crowns: any[] = [];
  const shades = ['#3e5a2c', '#4c6e35', '#5b7a3a', '#375227'];
  for (let i = 0; i < 8; i++) {
    const ang = rand() * Math.PI * 2;
    const rad = Math.pow(rand(), 0.65) * 95;
    const x = rnd(loc.x + Math.cos(ang) * rad * 1.15);
    const y = rnd(loc.y + Math.sin(ang) * rad * 0.68);
    const r = rnd(12 + rand() * 13);
    crowns.push(<circle key={i} cx={x} cy={y} r={r} fill={shades[i % shades.length]} fill-opacity={rnd(0.55 + rand() * 0.2)} />);
  }
  return <g class="veg-woods">{crowns}</g>;
}

/** Rounds to at most 1 decimal — keeps generated coordinates from bloating
 *  the served SVG with long float tails (the whole point of this file being
 *  hand-generated rather than a raster is that it stays small). */
function rnd(n: number): number {
  return Math.round(n * 10) / 10;
}

function Palm({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  const s = scale;
  return (
    <g transform={`translate(${x}, ${y}) scale(${s})`}>
      <path d="M0 0 C -3 -14, -1 -26, 3 -38" fill="none" stroke="#6b5133" stroke-width="3.2" stroke-linecap="round" />
      <g stroke="#4c6e35" stroke-width="3" stroke-linecap="round" fill="none">
        <path d="M3 -38 C -8 -42, -18 -38, -24 -30" />
        <path d="M3 -38 C -2 -48, -2 -56, 2 -62" />
        <path d="M3 -38 C 10 -46, 20 -46, 27 -40" />
        <path d="M3 -38 C 12 -36, 20 -30, 24 -22" />
      </g>
    </g>
  );
}

function HillContours() {
  const loc = LOCATIONS.hilltop;
  return (
    <g class="veg-hill" stroke="#7c6f42" stroke-opacity="0.4" fill="none" stroke-width="1.6">
      <ellipse cx={loc.x} cy={loc.y + 18} rx="98" ry="52" fill="#8a9a5c" fill-opacity="0.28" stroke="none" />
      <ellipse cx={loc.x} cy={loc.y + 14} rx="76" ry="40" />
      <ellipse cx={loc.x} cy={loc.y + 10} rx="52" ry="27" />
      <ellipse cx={loc.x} cy={loc.y + 6} rx="28" ry="15" />
    </g>
  );
}

/** The cairn at the hilltop's peak — its own function (not folded into
 *  HillContours) so the /notebook Landmark() can wrap ONLY the cairn, not
 *  the whole hillside. */
function Cairn() {
  const loc = LOCATIONS.hilltop;
  return (
    <g stroke="none">
      <ellipse cx={loc.x} cy={loc.y - 3} rx="9" ry="4" fill="#8a7a4c" />
      <ellipse cx={loc.x} cy={loc.y - 8} rx="6.5" ry="3.2" fill="#96875a" />
      <ellipse cx={loc.x} cy={loc.y - 12} rx="4" ry="2.2" fill="#a4956a" />
    </g>
  );
}

/** The shrine — a ring of weathered stones (patrons, spec §A2). Drawn only
 *  once discovered; before that it is plain fog like cave/wreck/cove (the
 *  generic FogUnknown loop in IslandMap() already covers it — LOCATIONS.shrine
 *  has discoveredAtStart: false, same as those three). Deliberately humbler
 *  than the Cairn (no gleam, no glow) — the shrine is Kevin and Jenny's own
 *  thing to make of, never dressed up as a landmark from above. */
function ShrineStones() {
  const loc = LOCATIONS.shrine;
  const stones: [number, number, number][] = [
    [-18, 6, 5], [-9, 10, 4.2], [1, 11, 4.6], [11, 8, 4], [17, 1, 4.8], [10, -6, 4], [-2, -8, 4.4], [-13, -4, 4.2],
  ];
  return (
    <g>
      <ellipse cx={loc.x} cy={loc.y + 4} rx="26" ry="14" fill="#7c6f42" fill-opacity="0.18" />
      {stones.map(([dx, dy, r], i) => (
        <ellipse key={i} cx={loc.x + dx} cy={loc.y + dy} rx={r} ry={r * 1.3} fill="#8a8378" stroke="#5a5548" stroke-width="0.8" fill-opacity="0.85" />
      ))}
    </g>
  );
}

function CliffsEdge() {
  const loc = LOCATIONS.cliffs;
  const rand = rngFor(917);
  const birds: any[] = [];
  for (let i = 0; i < 3; i++) {
    const x = rnd(loc.x - 70 + rand() * 150);
    const y = rnd(loc.y - 55 - rand() * 42);
    const w = rnd(7 + rand() * 4);
    birds.push(<path key={i} d={`M ${x - w} ${y} Q ${x} ${rnd(y - w * 0.8)} ${x + w} ${y}`} fill="none" stroke="#5a5240" stroke-width="1.4" stroke-linecap="round" opacity="0.7" />);
  }
  const edge = `M ${loc.x - 90} ${loc.y - 15} L ${loc.x - 60} ${loc.y + 12} L ${loc.x - 30} ${loc.y - 20} L ${loc.x} ${loc.y + 8} L ${loc.x + 32} ${loc.y - 18} L ${loc.x + 62} ${loc.y + 6} L ${loc.x + 92} ${loc.y - 16}`;
  return (
    <g>
      <path d={edge} fill="none" stroke="#8a7f66" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85" />
      {birds}
    </g>
  );
}

function Spring() {
  const loc = LOCATIONS.spring;
  return (
    <g>
      <ellipse cx={loc.x} cy={loc.y + 6} rx="22" ry="12" fill="#8a8378" fill-opacity="0.4" />
      <ellipse cx={loc.x} cy={loc.y + 6} rx="15" ry="8" fill="var(--sea-1)" stroke="var(--sea-2)" stroke-width="1.2" />
      <path d={`M ${loc.x - 4} ${loc.y - 20} C ${loc.x - 8} ${loc.y - 8}, ${loc.x - 2} ${loc.y - 2}, ${loc.x} ${loc.y + 2}`} fill="none" stroke="#bfe0e6" stroke-width="2.2" stroke-linecap="round" opacity="0.85" />
    </g>
  );
}

function Garden({ progress }: { progress: number | null }) {
  const loc = LOCATIONS.garden;
  const pct = progress ?? 5;
  const rows = 5;
  const filled = Math.round((pct / 100) * rows);
  const w = 60, h = 46;
  const x0 = loc.x - w / 2, y0 = loc.y - h / 2;
  const rowH = h / rows;
  return (
    <g>
      <rect x={x0 - 4} y={y0 - 4} width={w + 8} height={h + 8} rx="2" fill="none" stroke="#8a7a4c" stroke-width="4" opacity="0.65" />
      {Array.from({ length: rows }).map((_, i) => (
        <rect key={i} x={x0} y={y0 + i * rowH} width={w} height={rowH - 2}
          fill={i < filled ? '#5b7a3a' : '#6b5133'} fill-opacity={i < filled ? 0.85 : 0.55} />
      ))}
      <rect x={x0 - 4} y={y0 - 4} width={w + 8} height={h + 8} rx="2" fill="none" stroke="#3e5a2c" stroke-width="1.2" opacity="0.5" />
    </g>
  );
}

function Cottage({ home, cooking }: { home: boolean; cooking: boolean }) {
  const loc = LOCATIONS.cottage;
  const x = loc.x, y = loc.y;
  return (
    <g>
      <path d={`M ${x - 22} ${y - 12} L ${x} ${y - 28} L ${x + 22} ${y - 12} Z`} fill="#7a4630" stroke="#4a2a1a" stroke-width="1" />
      <rect x={x - 17} y={y - 12} width="34" height="22" fill="#e4d9bf" stroke="#8a7a4c" stroke-width="1" />
      <rect x={x - 12} y={y - 4} width="8" height="10" fill="#5a4326" />
      <rect x={x + 4} y={y - 6} width="7" height="6" fill="#bfe0e6" opacity="0.8" />
      {/* chimney */}
      <rect x={x + 11} y={y - 24} width="6" height="10" fill="#8a7159" />
      {home && (
        <g class={`chimney-smoke${cooking ? ' cooking' : ''}`} opacity="0.75">
          <ellipse cx={x + 14} cy={y - 30} rx="3.4" ry="4.4" fill="#d8cdb0" />
          <ellipse cx={x + 17} cy={y - 38} rx="4.6" ry="5.4" fill="#d8cdb0" opacity="0.7" />
          <ellipse cx={x + 15} cy={y - 47} rx="5.8" ry="6.2" fill="#d8cdb0" opacity="0.45" />
        </g>
      )}
    </g>
  );
}

/** A small tool shed beside the cottage — the /workshop door. Drawn (not
 *  requested-but-omitted): a lean-to roof, a plank door, and two tools
 *  hanging off a peg so it reads as "where things get made", not a second
 *  house. */
function WorkshopShed() {
  const loc = LOCATIONS.cottage;
  const x = loc.x - 42, y = loc.y + 4;
  return (
    <g>
      <path d={`M ${x - 13} ${y - 6} L ${x} ${y - 16} L ${x + 13} ${y - 6} Z`} fill="#5a4326" stroke="#3c3322" stroke-width="0.8" />
      <rect x={x - 10} y={y - 6} width="20" height="15" fill="#a58a5e" stroke="#5a4326" stroke-width="1" />
      <rect x={x - 3} y={y - 1} width="6" height="10" fill="#3c3322" />
      <line x1={x + 7} y1={y - 3} x2={x + 7} y2={y + 5} stroke="#3c3322" stroke-width="1.4" />
      <path d="M -3 -2 L 3 2" transform={`translate(${x + 4}, ${y - 1})`} stroke="#8a8378" stroke-width="1.4" stroke-linecap="round" />
    </g>
  );
}

function Dock() {
  const loc = LOCATIONS.dock;
  const x = loc.x, y = loc.y;
  const planks: any[] = [];
  for (let i = 0; i < 6; i++) {
    planks.push(<rect key={i} x={x - 8 + i * 11} y={y + i * 1.6 - 2} width="9" height="6" rx="1" fill="#8a6a3f" transform={`rotate(-7 ${x - 8 + i * 11} ${y + i * 1.6})`} />);
  }
  return (
    <g>
      <line x1={x - 10} y1={y + 6} x2={x + 58} y2={y - 4} stroke="#6b5133" stroke-width="7" stroke-linecap="round" opacity="0.5" />
      {planks}
      <line x1={x - 6} y1={y + 12} x2={x - 3} y2={y + 2} stroke="#5a4326" stroke-width="2.5" />
      <line x1={x + 52} y1={y + 4} x2={x + 55} y2={y - 6} stroke="#5a4326" stroke-width="2.5" />
      {/* dinghy, tied at the end */}
      <g transform={`translate(${x + 74}, ${y + 6})`}>
        <path d="M -14 0 Q -14 8 0 9 Q 14 8 14 0 Q 14 -3 0 -3 Q -14 -3 -14 0 Z" fill="#c47f3a" stroke="#7a4630" stroke-width="1.3" />
        <line x1="-7" y1="-3" x2="-7" y2="2" stroke="#7a4630" stroke-width="1.3" />
        <line x1="4" y1="-3" x2="4" y2="2" stroke="#7a4630" stroke-width="1.3" />
        <path d="M -14 4 Q 20 -10 -14 -2" fill="none" stroke="#5a4326" stroke-width="1" opacity="0.6" />
      </g>
    </g>
  );
}

/** A signpost at the dock — the /about door. */
function Signpost() {
  const loc = LOCATIONS.dock;
  const x = loc.x - 24, y = loc.y - 22;
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={y + 22} stroke="#6b5133" stroke-width="2.4" stroke-linecap="round" />
      <path d={`M ${x} ${y} L ${x + 17} ${y - 3} L ${x + 17} ${y + 5} L ${x} ${y + 3} Z`} fill="#a58a5e" stroke="#5a4326" stroke-width="1" />
      <path d={`M ${x} ${y + 6} L ${x - 15} ${y + 3} L ${x - 15} ${y + 11} L ${x} ${y + 9} Z`} fill="#a58a5e" stroke="#5a4326" stroke-width="1" />
    </g>
  );
}

function TidePools() {
  const loc = LOCATIONS.tidepools;
  const rocks = [
    [-30, -8, 20, 12], [8, -14, 24, 14], [26, 10, 16, 11],
  ];
  return (
    <g>
      {rocks.map((r, i) => (
        <ellipse key={i} cx={loc.x + r[0]} cy={loc.y + r[1]} rx={r[2]} ry={r[3]} fill="#5a5548" fill-opacity="0.75" />
      ))}
      <ellipse cx={loc.x - 4} cy={loc.y - 2} rx="9" ry="5.5" fill="var(--sea-1)" stroke="var(--sea-2)" stroke-width="1" />
      <ellipse cx={loc.x + 18} cy={loc.y + 12} rx="7" ry="4.5" fill="var(--sea-1)" stroke="var(--sea-2)" stroke-width="1" />
    </g>
  );
}

function Lighthouse({ lit }: { lit: boolean }) {
  const loc = LOCATIONS.lighthouse;
  const x = loc.x, y = loc.y;
  return (
    <g>
      <path d={`M ${x - 8} ${y + 30} L ${x - 6} ${y - 2} L ${x + 6} ${y - 2} L ${x + 8} ${y + 30} Z`} fill="#d8cdb0" stroke="#8a7a4c" stroke-width="1" />
      <rect x={x - 6} y={y + 10} width="12" height="5" fill="#c2185b" opacity="0.85" />
      <rect x={x - 7} y={y - 10} width="14" height="9" fill="#3c3322" stroke="#8a7a4c" stroke-width="1" />
      <path d={`M ${x - 9} ${y - 10} L ${x} ${y - 20} L ${x + 9} ${y - 10} Z`} fill="#c2185b" />
      {lit && (
        <g class="lamp-glow">
          <circle cx={x} cy={y - 6} r="3.2" fill="#ffe9a8" />
          <circle cx={x} cy={y - 6} r="9" fill="#ffe9a8" opacity="0.35" />
          <circle cx={x} cy={y - 6} r="16" fill="#ffe9a8" opacity="0.16" />
        </g>
      )}
    </g>
  );
}

function CaveMouth() {
  const loc = LOCATIONS.cave;
  return (
    <g>
      <ellipse cx={loc.x} cy={loc.y} rx="26" ry="18" fill="#3a3327" fill-opacity="0.5" />
      <ellipse cx={loc.x + 2} cy={loc.y + 2} rx="14" ry="9" fill="#17140f" />
    </g>
  );
}

function WreckRibs() {
  const [cx, cy] = centroidOf(REEF_WRECK);
  return (
    <g stroke="#6b5133" stroke-width="2.4" fill="none" stroke-linecap="round" opacity="0.8">
      <path d={`M ${cx - 24} ${cy + 4} Q ${cx - 20} ${cy - 16} ${cx - 14} ${cy + 2}`} />
      <path d={`M ${cx - 8} ${cy + 6} Q ${cx - 4} ${cy - 20} ${cx + 2} ${cy + 2}`} />
      <path d={`M ${cx + 8} ${cy + 4} Q ${cx + 12} ${cy - 14} ${cx + 18} ${cy}`} />
      <line x1={cx - 22} y1={cy + 4} x2={cx + 20} y2={cy + 2} stroke-width="2" opacity="0.7" />
    </g>
  );
}

/** A sea chest on the south beach — the /archive door UNTIL the wreck is
 *  discovered, at which point the wreck itself (WreckRibs, wrapped by the
 *  page below) takes over as that door; drawing both at once would be two
 *  doors to the same page. */
function SeaChest() {
  const loc = LOCATIONS.beach;
  const x = loc.x + 42, y = loc.y - 8;
  return (
    <g>
      <rect x={x - 9} y={y - 4} width="18" height="10" rx="1.5" fill="#6b5133" stroke="#3c3322" stroke-width="1" />
      <path d={`M ${x - 9} ${y - 4} Q ${x} ${y - 11} ${x + 9} ${y - 4}`} fill="#7a4630" stroke="#3c3322" stroke-width="1" />
      <rect x={x - 2} y={y - 4} width="4" height="3" fill="#c9bea3" />
    </g>
  );
}

function CoveIslet() {
  return (
    <g>
      <path d={smoothClosedPath(COVE_ISLET)} fill="#c9a35e" fill-opacity="0.9" stroke="#8a7a4c" stroke-width="1.2" />
      <ellipse cx="835" cy="316" rx="10" ry="6" fill="var(--sea-1)" opacity="0.7" />
    </g>
  );
}

/** A bottle bobbing offshore of the south beach — opens the message-in-a-
 *  bottle dialog directly (HomePage.tsx's #bottle-dialog), through the SAME
 *  generic `[data-open-dialog]` mechanism every other card uses (never the
 *  landmark-preview-card path: a bottle IS its own card, nothing to preview
 *  first). A real `href="#bottle-dialog"` still means a no-JS click reaches
 *  the real form via app.css's `dialog:target` fallback, never a dead click. */
function BottleProp() {
  const loc = LOCATIONS.beach;
  const x = loc.x - 6, y = loc.y + 26;
  return (
    <a href="#bottle-dialog" class="landmark bottle-landmark" aria-label="Throw a message in a bottle" data-open-dialog="bottle-dialog">
      <circle class="landmark-glow" cx={x} cy={y} r="18" fill="#fffdf6" opacity="0" filter="url(#landmarkGlow)" />
      <g class="bottle-bob" transform={`translate(${x}, ${y})`}>
        <path d="M -2.4 -9 L -2.4 -4 L -4.5 0 Q -4.5 6 0 6 Q 4.5 6 4.5 0 L 2.4 -4 L 2.4 -9 Z" fill="#5b8a5e" fill-opacity="0.85" stroke="#2e4a30" stroke-width="0.8" />
        <rect x="-1.6" y="-11.5" width="3.2" height="3" fill="#3c3322" />
        <path d="M -3.5 1 h 7 M -3.5 3 h 7" stroke="#eee5d0" stroke-width="0.5" opacity="0.6" />
      </g>
      <g class="landmark-label" transform={`translate(${x}, ${y - 24})`}>
        <rect x={-64} y="-10" width="128" height="17" rx="8.5" fill="#171208" fill-opacity="0.86" />
        <text x="0" y="1.5" text-anchor="middle" font-size="11" font-weight="700" fill="#fffdf6" class="hand-label">Throw a message in a bottle</text>
      </g>
      <circle class="landmark-hit" cx={x} cy={y} r="24" fill="transparent" />
    </a>
  );
}

function FogUnknown({ id }: { id: LocationId }) {
  const loc = LOCATIONS[id];
  // Position (outer, attribute transform) is kept apart from the drift
  // animation (inner, CSS transform) for the same reason as AgentFigure above
  // — a CSS transform on the SAME node as a `transform` attribute replaces
  // it, which is what put every undiscovered-place fog blob at the map's
  // origin corner instead of over its real location.
  return (
    <g class="fog-unknown" transform={`translate(${loc.x}, ${loc.y})`}>
      <g class="fog-blob">
        <circle r="26" fill="#3a3327" fill-opacity="0.5" filter="url(#fogBlur)" />
        <circle r="17" fill="#3a3327" fill-opacity="0.55" stroke="#eee5d0" stroke-opacity="0.3" stroke-dasharray="3 3" />
        <text x="0" y="6" text-anchor="middle" font-size="16" font-weight="700" fill="#eee5d0">?</text>
      </g>
    </g>
  );
}

function PlaceLabel({ id, dy = 24 }: { id: LocationId; dy?: number }) {
  const loc = LOCATIONS[id];
  const text = SHORT_LABEL[id];
  const w = text.length * 4.6 + 10;
  return (
    <g transform={`translate(${loc.x}, ${loc.y + dy})`} class="place-label">
      <rect x={-w / 2} y="-9" width={w} height="14" rx="7" fill="#fffdf6" fill-opacity="0.78" />
      <text x="0" y="1.5" text-anchor="middle" font-size="10.5" fill="#241f14" class="hand-label">{text}</text>
    </g>
  );
}

// ── surf: 3 foam rings that trace the coastline, staggered so they read as
//    waves breaking on the sand rather than a static outline ──
const SURF_RINGS: [number, number][][] = [
  scaleRing(COASTLINE, 1.02),
  SAND_RIM, // scaleRing(COASTLINE, 1.045) — the sand's own outer edge, exactly
  scaleRing(COASTLINE, 1.075),
];

function Surf() {
  return (
    <g class="surf-layer" aria-hidden="true">
      {SURF_RINGS.map((ring, i) => (
        <path key={i} class={`surf-ring surf-ring-${i}`} d={smoothClosedPath(ring)} />
      ))}
    </g>
  );
}

// ── the ocean layer: a FIXED, full-viewport backdrop BEHIND the pan/zoom
// stage (HomePage.tsx renders `.ocean-layer` — containing this — as a
// SIBLING of `.island-viewport`, earlier in DOM order so it paints behind
// it). The base tint is plain CSS (app.css's `.ocean-layer`, a
// radial-gradient using the SAME `--sea-1`/`--sea-2` custom properties the
// map's own shallows/reef paint with — one colour system, not two to drift
// apart). This component supplies only the drifting shimmer on top of that:
// small low-opacity arcs scattered across a viewBox generously larger than
// any real viewport and sliced to always fully cover it
// (`preserveAspectRatio="xMidYMid slice"`), so panning the island never
// walks off the edge of them. Deliberately NOT part of `.map-stage` — these
// represent the open ocean filling infinite space beyond the island, so
// they stay screen-relative rather than panning/zooming with it, the same
// way real background scenery would in a 2D game. Seeded PRNG (see this
// file's header comment): same output every render, never Math.random(). */
const OCEAN_SHIMMER_SEED = 5501;
export function OceanShimmer() {
  const rand = rngFor(OCEAN_SHIMMER_SEED);
  const strokes: any[] = [];
  for (let i = 0; i < 16; i++) {
    const x = rnd(rand() * 1600);
    const y = rnd(rand() * 1000);
    const w = rnd(26 + rand() * 34);
    // Calmer motion pass (owner: "movement... so fast"): durations ×1.5 —
    // was 7-13s, now 10.5-19.5s. Opacity is toned down in app.css's own
    // oceanShimmerDrift keyframes, not here (nothing here draws opacity).
    const dur = rnd(10.5 + rand() * 9);
    const delay = rnd(rand() * 7);
    strokes.push(
      <path key={i} class="ocean-shimmer-stroke"
        d={`M ${x - w / 2} ${y} Q ${x} ${rnd(y - w * 0.22)} ${x + w / 2} ${y}`}
        style={`--dur:${dur}s;--delay:${delay}s;`} />
    );
  }
  return (
    <svg class="ocean-shimmer" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      {strokes}
    </svg>
  );
}

// ── the map ──

export function IslandMap({ world }: { world: PublicWorld }) {
  const discovered = new Set<LocationId>(world.discovered);
  const gardenProgress = findProjectProgress(world.projects, 'garden');
  const someoneHome = world.agents.kevin.location === 'cottage' || world.agents.jenny.location === 'cottage';
  const someoneCooking = (world.agents.kevin.location === 'cottage' && world.agents.kevin.activity === 'cooking')
    || (world.agents.jenny.location === 'cottage' && world.agents.jenny.activity === 'cooking');
  const lampLit = world.slot === 'night' || world.slot === 'evening' || world.slot === 'dawn';
  const sharedLocation = world.agents.kevin.location === world.agents.jenny.location;
  const wreckFound = discovered.has('wreck');

  return (
    <div class="map-wrap" data-slot={world.slot} data-weather={world.weather.kind} data-tide={world.tide} role="img"
      aria-label={`Sorrel Island, day ${world.day}, ${world.slot}, ${world.weather.line}. Kevin at ${LOCATIONS[world.agents.kevin.location].name}, Jenny at ${LOCATIONS[world.agents.jenny.location].name}.`}>
      {/* "meet" (never "slice"): SPEC3's pan/zoom needs the WHOLE island
          visible at scale 1 (the fit baseline script.js's PanZoom starts
          from), not a crop — the user zooms in themselves. mapTransform() in
          public/script.js assumes "meet" (Math.min of the two axis scales);
          changing this back to "slice" would silently break bubble
          positioning everywhere except a 1000:640 viewport. */}
      <svg viewBox="0 0 1000 640" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--sky-1, #8fd0ee)" />
            <stop offset="100%" stop-color="var(--sky-2, #cdeefb)" />
          </linearGradient>
          <radialGradient id="land" cx="46%" cy="38%" r="72%">
            <stop offset="0%" stop-color="var(--grass)" />
            <stop offset="72%" stop-color="var(--grass)" />
            <stop offset="100%" stop-color="var(--sand)" />
          </radialGradient>
          <filter id="fogBlur" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
          <filter id="landmarkGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        {/* Owner: "remove background around the island, it's 2 different
            color, and add something like water waves around the island".
            This SVG no longer paints its own opaque "deep sea" — that's now
            a FIXED, full-viewport layer BEHIND the whole pan/zoom stage
            (HomePage.tsx's `.ocean-layer`, island-map.tsx's OceanShimmer()
            below), so the ocean is ONE continuous surface at every zoom and
            pan position, never a bounded rect with an edge. `.map-wrap`
            (app.css) is transparent, so that fixed layer shows straight
            through wherever nothing here paints over it — including this
            "sky" wash, now a faint slot-tinted accent (0.15 opacity, was
            effectively ~0.1 before too, just as a side effect of the old
            opaque sea rect covering 90% of it) rather than a second
            competing dominant colour. Freed from sitting under that same
            opaque rect, the stars are fully visible now too — a bug that
            was silently self-inflicted the whole time this map existed. */}
        {/* ⚠️ Far larger than the map on purpose: bounded to 0–1000×0–640 this tint drew a visible lighter RECTANGLE over the endless ocean layer (the owner saw "2 different colors" around the island). Overlays must never have an edge anyone can pan or zoom to. */}
        <rect x="-4000" y="-4000" width="9000" height="8640" fill="url(#sky)" opacity="0.15" />
        <g class="stars" opacity="0.9">
          {[[80,40],[150,90],[260,30],[900,50],[60,150],[880,180],[500,40]].map(([x,y],i) => (
            <circle key={i} cx={x} cy={y} r="1.6" fill="#fff" />
          ))}
        </g>

        {/* shallow band — a lighter ring of water between the reef and the shore */}
        <path d={smoothClosedPath(SHALLOWS)} fill="var(--sea-1)" opacity="0.38" />
        {/* reef ring */}
        <path d={smoothClosedPath(REEF_RING)} fill="none" stroke="#fffdf6" stroke-opacity="0.3" stroke-width="2" stroke-dasharray="1 7" stroke-linecap="round" />
        {/* wave strokes, scattered over open water inside the map's own
            bounds — OceanShimmer() below covers the open water BEYOND them
            (i.e. wherever panning/zooming reveals space outside the island
            SVG's own rect), so together the two never leave a patch of
            water with no life in it. */}
        <g class="wave-layer" stroke="#fffdf6" stroke-opacity="0.22" stroke-width="1.6" stroke-linecap="round" fill="none">
          {[[80,90],[930,110],[70,470],[900,560]].map(([x,y],i) => (
            <path key={i} class="wave-drift" d={`M ${x-16} ${y} Q ${x} ${y-5} ${x+16} ${y}`} style={`animation-delay:${(i % 5) * 0.9}s`} />
          ))}
        </g>

        {/* the reef the wreck sits on — always bare rock; once discovered it becomes the /archive door */}
        {wreckFound ? (
          <Landmark href="/archive" label="The talking era archive" cx={centroidOf(REEF_WRECK)[0]} cy={centroidOf(REEF_WRECK)[1]} hitR={30} landmarkKey="wreck">
            <path d={toPath(REEF_WRECK)} fill="#8a8378" fill-opacity="0.55" />
            <WreckRibs />
          </Landmark>
        ) : (
          <path d={toPath(REEF_WRECK)} fill="#8a8378" fill-opacity="0.55" />
        )}
        {discovered.has('cove') && <CoveIslet />}

        {/* sand rim, then the landmass on top of it */}
        <path d={smoothClosedPath(SAND_RIM)} fill="var(--sand)" stroke="#8a7a4c" stroke-opacity="0.3" stroke-width="1.5" />
        <path d={smoothClosedPath(COASTLINE)} fill="url(#land)" stroke="#6b5f3e" stroke-opacity="0.35" stroke-width="2" />
        {/* surf — soft foam rings following the coastline, swelling out and
            fading, staggered (owner: "add something like water waves
            around the island"). Anchored to the SAME coastline geometry as
            the sand rim (scaleRing/smoothClosedPath, no separate hand-drawn
            shape to fall out of sync), so it pans/zooms WITH the island —
            unlike OceanShimmer() below, which deliberately does not. */}
        <Surf />

        {/* vegetation & landmarks */}
        <WoodsCluster />
        <Palm x={LOCATIONS.woods.x + 78} y={LOCATIONS.woods.y + 58} scale={0.9} />
        <Palm x={LOCATIONS.beach.x - 46} y={LOCATIONS.beach.y - 30} scale={1.05} />
        <Palm x={LOCATIONS.dock.x - 8} y={LOCATIONS.dock.y - 34} scale={0.85} />
        {discovered.has('woods') && <PlainSpot landmarkKey="woods" label="The woods" cx={LOCATIONS.woods.x} cy={LOCATIONS.woods.y} hitR={34} />}
        <HillContours />
        {discovered.has('hilltop') && <PlainSpot landmarkKey="hilltop-open" label="The hilltop" cx={LOCATIONS.hilltop.x - 30} cy={LOCATIONS.hilltop.y + 20} hitR={20} />}
        <CliffsEdge />
        {discovered.has('cliffs') && <PlainSpot landmarkKey="cliffs" label="The north cliffs" cx={LOCATIONS.cliffs.x} cy={LOCATIONS.cliffs.y + 24} hitR={26} />}
        <Spring />
        {discovered.has('spring') && <PlainSpot landmarkKey="spring" label="The spring" cx={LOCATIONS.spring.x} cy={LOCATIONS.spring.y} hitR={18} />}
        <Garden progress={gardenProgress} />
        {discovered.has('garden') && <PlainSpot landmarkKey="garden" label="The garden" cx={LOCATIONS.garden.x} cy={LOCATIONS.garden.y} hitR={22} />}

        <Landmark href="/days" label="Their days — the story so far" cx={LOCATIONS.cottage.x} cy={LOCATIONS.cottage.y - 4} hitR={26} landmarkKey="cottage">
          <Cottage home={someoneHome} cooking={someoneCooking} />
        </Landmark>
        <Landmark href="/workshop" label="Things they made" cx={LOCATIONS.cottage.x - 42} cy={LOCATIONS.cottage.y + 4} hitR={18} landmarkKey="workshop">
          <WorkshopShed />
        </Landmark>
        <Landmark href="/about" label="About" cx={LOCATIONS.dock.x - 24} cy={LOCATIONS.dock.y - 10} hitR={20} landmarkKey="signpost">
          <Signpost />
        </Landmark>
        <Dock />
        {discovered.has('dock') && <PlainSpot landmarkKey="dock" label="The dock" cx={LOCATIONS.dock.x + 40} cy={LOCATIONS.dock.y + 4} hitR={22} />}

        {/* beach band */}
        <path d="M556 556 Q650 602 726 540 L724 558 Q650 616 552 578 Z" fill="var(--sand)" opacity="0.9" />
        {discovered.has('beach') && <PlainSpot landmarkKey="beach" label="South beach" cx={LOCATIONS.beach.x + 30} cy={LOCATIONS.beach.y - 40} hitR={22} />}
        <TidePools />
        {discovered.has('tidepools') && <PlainSpot landmarkKey="tidepools" label="The tide pools" cx={LOCATIONS.tidepools.x} cy={LOCATIONS.tidepools.y} hitR={22} />}
        {!wreckFound && (
          <a href="/archive" class="landmark" aria-label="The talking era archive" data-landmark data-landmark-key="chest">
            <SeaChest />
            <circle class="landmark-hit" cx={LOCATIONS.beach.x + 42} cy={LOCATIONS.beach.y - 8} r="20" fill="transparent" />
          </a>
        )}
        <BottleProp />
        {discovered.has('cave') && <CaveMouth />}
        {discovered.has('cave') && <PlainSpot landmarkKey="cave" label="The sea cave" cx={LOCATIONS.cave.x} cy={LOCATIONS.cave.y} hitR={26} />}
        {discovered.has('cove') && <PlainSpot landmarkKey="cove" label="Hidden cove" cx={835} cy={316} hitR={24} />}

        <Landmark href="/lab" label="The Lab — charts & research" cx={LOCATIONS.lighthouse.x} cy={LOCATIONS.lighthouse.y} hitR={24} landmarkKey="lighthouse">
          <Lighthouse lit={lampLit} />
        </Landmark>
        <Landmark href="/notebook" label="What they've learned" cx={LOCATIONS.hilltop.x} cy={LOCATIONS.hilltop.y - 8} hitR={20} landmarkKey="hilltop">
          <Cairn />
        </Landmark>
        {/* Patrons (spec §A2): fogged (the generic undiscovered-places loop
            below) until the first gift crate arrives; from then on, a real door. */}
        {discovered.has('shrine') && (
          <Landmark href="/shrine" label="The shrine" cx={LOCATIONS.shrine.x} cy={LOCATIONS.shrine.y} hitR={26} landmarkKey="shrine">
            <ShrineStones />
          </Landmark>
        )}

        {/* weather layers, toggled by [data-weather] in app.css */}
        <g class="rain-layer">
          {Array.from({ length: 12 }).map((_, i) => (
            <line key={i} class="rain-drop" x1={40 + (i * 79) % 960} y1={-10 + (i % 5) * 8} x2={30 + (i * 79) % 960} y2={20 + (i % 5) * 8}
              stroke="#cfe6ee" stroke-width="1.6" style={`animation-delay:${(i % 7) * 0.12}s`} />
          ))}
        </g>
        <g class="fog-layer">
          <ellipse class="fog-blob" cx="300" cy="300" rx="220" ry="90" fill="#eef2f0" opacity="0.5" />
          <ellipse class="fog-blob" cx="650" cy="400" rx="240" ry="100" fill="#eef2f0" opacity="0.45" style="animation-delay:2s" />
        </g>
        <rect class="storm-flash" x="-4000" y="-4000" width="9000" height="8640" fill="#fff" />
        <g class="heat-layer">
          <rect x="-4000" y="-4000" width="9000" height="8640" fill="#ffb347" opacity="0.12" />
        </g>

        {/* undiscovered places — soft fog, no shape given away */}
        {(Object.keys(LOCATIONS) as LocationId[]).filter((id) => !discovered.has(id)).map((id) => (
          <FogUnknown key={id} id={id} />
        ))}

        {/* hand-lettered place names for everywhere already found */}
        {(Object.keys(LOCATIONS) as LocationId[]).filter((id) => discovered.has(id)).map((id) => (
          <PlaceLabel key={id} id={id} />
        ))}

        {/* agents — drawn last so they always read on top of the scenery */}
        <AgentFigure id="kevin" a={world.agents.kevin} shared={sharedLocation} />
        <AgentFigure id="jenny" a={world.agents.jenny} shared={sharedLocation} />
      </svg>
    </div>
  );
}
