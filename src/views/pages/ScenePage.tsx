/** @jsxImportSource hono/jsx */
// /scene/:id — one scene's full transcript, thoughts & actions included.

import { BaseLayout } from '../BaseLayout';
import type { Tint } from '../chrome';
import { TurnBody, splitApartTurns } from '../turn';
import { BIOGRAPHIES, LOCATIONS } from '../../world/bio';
import { getScene, getSceneTurns, getScenesForDay, type SceneTurnRow } from '../../world/store';
import type { AgentId, LocationId, SceneRow } from '../../world/types';

export interface ScenePageData {
  scene: SceneRow;
  turns: SceneTurnRow[];
  prevSceneId: string | null;
  nextSceneId: string | null;
}

export async function fetchScenePageData(db: D1Database, id: string): Promise<ScenePageData | null> {
  const scene = await getScene(db, id);
  if (!scene) return null;
  // Previous/next within the SAME day (SPEC3: sheet pages get ←/→ icons on
  // day/scene pages) — one extra cheap query, already used by DayPage for
  // the same day's list, so this never becomes a second source of truth for
  // "what order do a day's scenes happen in".
  const [turns, dayScenes] = await Promise.all([
    getSceneTurns(db, id, 200),
    getScenesForDay(db, scene.day),
  ]);
  const idx = dayScenes.findIndex((s) => s.id === id);
  const prevSceneId = idx > 0 ? dayScenes[idx - 1].id : null;
  const nextSceneId = idx >= 0 && idx < dayScenes.length - 1 ? dayScenes[idx + 1].id : null;
  return { scene, turns, prevSceneId, nextSceneId };
}

/** Apart's `apart_json` shape, mirroring SceneState.apart / NextScene.apart
 *  (src/world/types.ts) — parsed defensively since it is untyped D1 text. */
interface ApartInfo { location: LocationId; doing: string; setup: string }

function parseApartJson(raw: string | null): Record<AgentId, ApartInfo> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object' && v.kevin && v.jenny) return v as Record<AgentId, ApartInfo>;
  } catch { /* fall through */ }
  return null;
}

export function ScenePage({ data, tint }: { data: ScenePageData; tint?: Tint }) {
  const { scene, turns, prevSceneId, nextSceneId } = data;
  const url = `https://livingcore.cc/scene/${scene.id}`;
  const description = (scene.summary || scene.setup || '').replace(/\s+/g, ' ').trim().slice(0, 155);
  const apart = scene.mode === 'apart' ? parseApartJson(scene.apart_json) : null;

  return (
    <BaseLayout
      tint={tint}
      prevNav={prevSceneId ? { href: `/scene/${prevSceneId}`, label: 'Previous scene' } : undefined}
      nextNav={nextSceneId ? { href: `/scene/${nextSceneId}`, label: 'Next scene' } : undefined}
      title={`${scene.title.slice(0, 55)} — Day ${scene.day} — Living Core`}
      description={description || `A scene on Sorrel Island, day ${scene.day}, ${scene.slot} at ${LOCATIONS[scene.location]?.name}.`}
      canonicalUrl={url}
      ogType="article"
      jsonLd={{
        '@type': 'Article',
        headline: scene.title,
        description,
        articleSection: 'Scene',
        datePublished: scene.opened_at,
        dateModified: scene.closed_at || scene.opened_at,
        author: [{ '@type': 'Organization', name: 'Kevin & Jenny (island era)' }],
        publisher: { '@id': 'https://www.lumorabuild.com/#organization' },
        isPartOf: { '@id': 'https://livingcore.cc/#dataset' },
        url,
      }}
    >
      <div class="wrap">
        <p class="muted" style="margin:14px 0 0;"><a href={`/day/${scene.day}`}>← Day {scene.day}</a></p>
        <div class="scene-kicker">
          {apart
            ? `Apart — ${BIOGRAPHIES.kevin.name} at ${LOCATIONS[apart.kevin.location]?.name || apart.kevin.location}, ${BIOGRAPHIES.jenny.name} at ${LOCATIONS[apart.jenny.location]?.name || apart.jenny.location}`
            : `${LOCATIONS[scene.location]?.name || scene.location} · day ${scene.day} · ${scene.slot}`}
        </div>
        <h1>{scene.title}</h1>
        <p class="scene-setup">{scene.setup}</p>
        {scene.summary && <p class="muted" style="font-size:13px;">{scene.summary}</p>}

        {apart ? (
          <div class="apart-tracks scene-apart-tracks">
            <ApartTrack id="kevin" info={apart.kevin} turns={splitApartTurns(turns).kevin} />
            <ApartTrack id="jenny" info={apart.jenny} turns={splitApartTurns(turns).jenny} />
          </div>
        ) : (
          <div class="scene-card">
            {turns.length === 0 && <p class="muted">No turns recorded.</p>}
            {turns.map((t) => <SceneTurnRowView key={t.id} t={t} />)}
          </div>
        )}
      </div>
    </BaseLayout>
  );
}

function SceneTurnRowView({ t }: { t: SceneTurnRow }) {
  return (
    <div class={`turn ${t.speaker}`}>
      <div class="turn-head">
        <span class="turn-name">{BIOGRAPHIES[t.speaker as AgentId].emoji} {BIOGRAPHIES[t.speaker as AgentId].name}</span>
        <span class="turn-time">{(t.created_at || '').slice(11, 16)}</span>
      </div>
      <TurnBody t={t} />
      {t.thought && (
        <details class="thought-peek">
          <summary>💭 peek at the thought</summary>
          <div class="thought-body">{t.thought}</div>
        </details>
      )}
      <p class="muted" style="font-size:10.5px;margin-top:4px;">{t.model}</p>
    </div>
  );
}

/** One agent's column in an apart scene — their own place + what they were
 *  doing there (the scene's own `apart` record, present-tense, written once
 *  when the scene opened) above their own turns in order. */
function ApartTrack({ id, info, turns }: { id: AgentId; info: ApartInfo; turns: SceneTurnRow[] }) {
  const bio = BIOGRAPHIES[id];
  return (
    <div class="apart-track scene-card" data-agent={id}>
      <div class={`apart-track-head ${id}`}>{bio.emoji} {bio.name} — alone at {LOCATIONS[info.location]?.name || info.location}</div>
      <p class="scene-setup" style="font-size:.92rem;">{info.setup}</p>
      {turns.length === 0 && <p class="muted">Quiet so far.</p>}
      {turns.map((t) => <SceneTurnRowView key={t.id} t={t} />)}
    </div>
  );
}
