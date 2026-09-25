/** @jsxImportSource hono/jsx */
// ─────────────────────────────────────────────────────────────────────────────
// /day/:n — an almanac page: the day's chapter in serif, a real pull-quote,
// the day's scenes (collapsible transcripts with thoughts), events (= "what
// changed" — the narrator already writes deltas as plain events: xp, project
// progress, discoveries, items, supply), and prev/next.
// ─────────────────────────────────────────────────────────────────────────────

import { BaseLayout } from '../BaseLayout';
import type { Tint } from '../chrome';
import { TurnBody } from '../turn';
import { collapseConsecutive } from '../timeline-utils';
import { BIOGRAPHIES, LOCATIONS } from '../../world/bio';
import { getChapter, getScenesForDay, getEventsForDay, getSceneTurns, type SceneTurnRow } from '../../world/store';
import type { AgentId, ChapterRow, SceneRow, WorldEventRow } from '../../world/types';

export interface DayPageData {
  day: number;
  chapter: ChapterRow | null;
  scenes: SceneRow[];
  turnsByScene: Record<string, SceneTurnRow[]>;
  events: WorldEventRow[];
  exists: boolean;
}

export async function fetchDayPageData(db: D1Database, day: number): Promise<DayPageData> {
  const [chapter, scenes, events] = await Promise.all([
    getChapter(db, day),
    getScenesForDay(db, day),
    getEventsForDay(db, day),
  ]);

  const turnsByScene: Record<string, SceneTurnRow[]> = {};
  for (const s of scenes.filter((s) => s.status === 'closed').slice(0, 12)) {
    turnsByScene[s.id] = await getSceneTurns(db, s.id, 60);
  }

  return { day, chapter, scenes, turnsByScene, events, exists: !!chapter || scenes.length > 0 };
}

export function DayPage({ data, tint }: { data: DayPageData; tint?: Tint }) {
  const { day, chapter, scenes, turnsByScene, events } = data;
  const paragraphs = chapter ? chapter.body.split(/\n{2,}/).filter(Boolean) : [];
  const quote = paragraphs.find((p) => /["“]/.test(p)) || paragraphs[0] || '';
  const title = chapter ? chapter.title : `Day ${day}`;
  const description = (chapter ? chapter.body.replace(/\s+/g, ' ').trim().slice(0, 155) : `Day ${day} on Sorrel Island — scenes, events and what changed.`);

  return (
    <BaseLayout
      tint={tint}
      prevNav={day > 1 ? { href: `/day/${day - 1}`, label: `Day ${day - 1}` } : undefined}
      nextNav={{ href: `/day/${day + 1}`, label: `Day ${day + 1}` }}
      title={`Day ${day} — ${title.slice(0, 40)} — Living Core`}
      description={description}
      canonicalUrl={`https://livingcore.cc/day/${day}`}
      ogType="article"
      jsonLd={chapter ? {
        '@type': 'Article',
        headline: chapter.title,
        description,
        articleSection: 'Chapter',
        datePublished: chapter.created_at,
        author: { '@type': 'Organization', name: 'Kevin & Jenny (island era)' },
        publisher: { '@id': 'https://www.lumorabuild.com/#organization' },
        isPartOf: { '@id': 'https://livingcore.cc/#dataset' },
        url: `https://livingcore.cc/day/${day}`,
      } : undefined}
    >
      <div class="wrap">
        <p class="muted" style="margin:14px 0 0;"><a href="/days">← Days</a></p>
        <h1>Day {day}</h1>

        {chapter ? (
          <article class="prose">
            <p class="mono muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">{chapter.title}</p>
            {quote && <p class="pull-quote" style="font-style:italic;border-left:3px solid var(--gold);padding-left:12px;">{quote}</p>}
            {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
          </article>
        ) : (
          <p class="muted">The chapter for this day hasn't been written yet — it's written once the day closes.</p>
        )}

        <div class="section">
          <div class="section-head"><h2>Scenes</h2></div>
          {scenes.length === 0 && <p class="muted">No scenes yet.</p>}
          {scenes.map((s) => (
            <details class="scene-card" key={s.id} open={scenes.length <= 3}>
              <summary style="cursor:pointer;list-style:none;">
                <span class="scene-kicker">{LOCATIONS[s.location]?.name || s.location} · {s.slot}</span>
                <h3 style="margin:2px 0 0;">{s.title}</h3>
              </summary>
              <p class="scene-setup">{s.setup}</p>
              {s.summary && <p class="muted" style="font-size:12.5px;">{s.summary}</p>}
              <div>
                {(turnsByScene[s.id] || []).map((t) => (
                  <div class={`turn ${t.speaker}`} key={t.id}>
                    <div class="turn-head">
                      <span class="turn-name">{BIOGRAPHIES[t.speaker as AgentId].emoji} {BIOGRAPHIES[t.speaker as AgentId].name}</span>
                      <span class="turn-time">{(t.created_at || '').slice(11, 16)}</span>
                    </div>
                    <TurnBody t={t} />
                    {t.thought && (
                      <details class="thought-peek">
                        <summary>💭 thought</summary>
                        <div class="thought-body">{t.thought}</div>
                      </details>
                    )}
                  </div>
                ))}
              </div>
              <p class="muted" style="font-size:11.5px;margin-top:8px;"><a href={`/scene/${s.id}`}>Open this scene on its own page →</a></p>
            </details>
          ))}
        </div>

        {events.length > 0 && (
          <div class="section">
            <div class="section-head"><h2>What changed</h2></div>
            <div class="timeline">
              {collapseConsecutive(events, (e) => `${e.kind}:${e.detail}`).map((e) => (
                <div class="tl-item event" key={e.id}>
                  <span class="tl-dot"></span>
                  <div class="tl-body">
                    <span style="font-weight:600;">{e.detail}</span>
                    <div class="tl-meta">{e.kind} · {e.slot}</div>
                  </div>
                  {e.repeatCount > 1 && <span class="tl-repeat">×{e.repeatCount}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div class="pagination">
          <a href={`/day/${day - 1}`}>← Day {day - 1}</a>
          <a href={`/day/${day + 1}`}>Day {day + 1} →</a>
        </div>
      </div>
    </BaseLayout>
  );
}
