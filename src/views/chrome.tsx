/** @jsxImportSource hono/jsx */
// ─────────────────────────────────────────────────────────────────────────────
// SHARED FLOATING CHROME — SPEC3 ("the island IS the website … no header and
// footer like the old website"). This is the ONE place every page outside the
// home map gets its "back to the island" + menu icons, its blurred backdrop,
// and the tiny network credit line — so the old <header>/<nav>/<footer>/
// disclaimer bar never quietly comes back on a page someone forgot to touch.
//
// The home page (HomePage.tsx) builds its own fuller HUD (it needs more:
// follow, thoughts toggle, zoom, the clock chip) but reuses MenuDialog and
// CreditLine from here so the nav list and the credit line are only ever
// written once.
// ─────────────────────────────────────────────────────────────────────────────

import { COASTLINE, SAND_RIM, smoothClosedPath } from './island-map';
import { loadWorld } from '../world/store';
import type { Slot, WeatherKind } from '../world/types';

export interface Tint { slot: Slot; weatherKind: WeatherKind }

const DEFAULT_TINT: Tint = { slot: 'midday', weatherKind: 'clear' };

/**
 * One cheap read (system_state's single "world" row — the same query
 * HomePage's fetchHomePageData already makes) so a sheet page's blurred
 * backdrop matches the island's current light instead of a fixed guess.
 * Every non-home route is edge-cached for minutes (src/cache.ts's
 * ARCHIVE_PAGE/DERIVED_JSON), so this runs far less often than it looks.
 * Never throws: a DB hiccup falls back to a plain midday tint rather than
 * failing the whole page over a background decoration.
 */
export async function loadTint(db: D1Database): Promise<Tint> {
  try {
    const w = await loadWorld(db);
    return w ? { slot: w.slot, weatherKind: w.weather.kind } : DEFAULT_TINT;
  } catch {
    return DEFAULT_TINT;
  }
}

export const MENU_LINKS: { href: string; label: string }[] = [
  { href: '/', label: 'The island' },
  { href: '/days', label: 'Their days — the story so far' },
  { href: '/lab', label: 'The Lab — charts & research' },
  { href: '/workshop', label: 'Things they made' },
  { href: '/notebook', label: "What they've learned" },
  { href: '/archive', label: 'The talking-era archive' },
  { href: '/about', label: 'About this experiment' },
];

export const DATASET_LINKS: { href: string; label: string }[] = [
  { href: '/api/export/dialogue.jsonl', label: 'Dialogue turns (JSONL)' },
  { href: '/api/export/world.jsonl', label: 'World events (JSONL)' },
  { href: '/api/export/scenes.jsonl', label: 'Scenes (JSONL)' },
  { href: '/api/export/island.json', label: 'Island state (JSON)' },
  { href: '/api/export/metrics.json', label: 'Metrics (JSON)' },
  { href: '/api/export/minds.json', label: 'Agent minds (JSON)' },
  { href: '/api/export/meta.json', label: 'Experiment metadata (JSON)' },
];

/**
 * The menu card — SAME markup on the home page and every sheet page, so it
 * only has to be right once. A real `<a href>` list throughout: works with
 * JS off (a click just navigates), and with JS the trigger only ever calls
 * `dialog.showModal()` instead of following the `#menu-dialog` fragment —
 * see public/script.js's `initDialogs()`.
 */
export function MenuDialog() {
  return (
    <dialog id="menu-dialog" class="card-dialog menu-dialog" aria-labelledby="menu-dialog-title">
      <div class="dialog-head">
        <h2 id="menu-dialog-title">Sorrel Island</h2>
        <a href="/" class="dialog-close" data-dialog-close aria-label="Close">✕</a>
      </div>
      <nav aria-label="Island" class="menu-nav">
        {MENU_LINKS.map((l) => <a href={l.href} key={l.href}>{l.label}</a>)}
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

/**
 * The one line that replaces the old footer bar everywhere: the required
 * "a Lumora Build experiment" link (CLAUDE.md — keeps the network's link
 * graph) plus the "live experiment, what they say is their own" note that
 * used to live in the disclaimer bar. Never a bar of its own — a single
 * line at the end of a sheet, or inside the home page's info card.
 */
export function CreditLine() {
  return (
    <p class="credit-line">
      <a href="https://www.lumorabuild.com/" target="_blank" rel="noopener">a Lumora Build experiment</a>
      {' — '}
      <span class="muted">live experiment: Kevin &amp; Jenny think on free, open models — what they say is their own.</span>
    </p>
  );
}

/**
 * The floating icons for every page that ISN'T the home map: a way back to
 * the island (top-left) and the shared menu (top-right), plus optional
 * prev/next for a day or a scene page. No header, no nav bar, no footer.
 */
export function SheetChrome({ prev, next }: { prev?: { href: string; label: string }; next?: { href: string; label: string } }) {
  return (
    <>
      <div class="floating-icons floating-icons-tl">
        <a href="/" class="icon-btn" aria-label="Back to the island"><span aria-hidden="true">🏝</span></a>
      </div>
      <div class="floating-icons floating-icons-tr">
        {prev && <a href={prev.href} class="icon-btn" aria-label={prev.label}>←</a>}
        {next && <a href={next.href} class="icon-btn" aria-label={next.label}>→</a>}
        <a href="#menu-dialog" class="icon-btn" data-open-dialog="menu-dialog" aria-label="Menu"><span aria-hidden="true">☰</span></a>
      </div>
      <MenuDialog />
    </>
  );
}

const SKY: Record<Slot, [string, string]> = {
  dawn: ['#ffd9ad', '#f7a978'], morning: ['#bfe4f2', '#eef7ea'], midday: ['#8fd0ee', '#cdeefb'],
  afternoon: ['#a9d7ea', '#f3e3ae'], evening: ['#6a4a86', '#e8895f'], night: ['#10142b', '#262c52'],
};

/**
 * A cheap, static, BLURRED rendering behind the paper sheet — no agents, no
 * weather layers, no walking, no landmark links (SPEC3 §"Every other page":
 * "cheap; no animation"). Reuses the live map's own coastline geometry (see
 * island-map.tsx's exported COASTLINE/SAND_RIM) so it still reads as Sorrel
 * Island underneath the reading, just softened — one silhouette, drawn once,
 * never a second hand-maintained copy of the island's shape.
 */
export function SheetBackdrop({ tint }: { tint: Tint }) {
  const [sky1, sky2] = SKY[tint.slot] || SKY.midday;
  return (
    <div class="sheet-backdrop" aria-hidden="true" style={`--bd-sky-1:${sky1};--bd-sky-2:${sky2};`}>
      <svg viewBox="0 0 1000 640" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="bdSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color={sky1} />
            <stop offset="100%" stop-color={sky2} />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="1000" height="640" fill="url(#bdSky)" />
        <rect x="0" y="0" width="1000" height="640" fill="var(--sea-2)" opacity="0.55" />
        <path d={smoothClosedPath(SAND_RIM)} fill="var(--sand)" />
        <path d={smoothClosedPath(COASTLINE)} fill="var(--grass)" />
      </svg>
    </div>
  );
}
