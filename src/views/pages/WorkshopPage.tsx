/** @jsxImportSource hono/jsx */
// /workshop — gallery grid of everything Kevin & Jenny have made, filter by
// maker via ?maker=kevin|jenny.

import { BaseLayout } from '../BaseLayout';
import type { Tint } from '../chrome';
import { BIOGRAPHIES } from '../../world/bio';
import { listArtifacts, countArtifacts } from '../../world/store';
import type { AgentId, ArtifactRow } from '../../world/types';

const PER_PAGE = 24;

export interface WorkshopPageData {
  artifacts: ArtifactRow[];
  maker: AgentId | null;
  page: number;
  total: number;
}

export async function fetchWorkshopPageData(db: D1Database, maker: AgentId | null, page: number): Promise<WorkshopPageData> {
  const safePage = Math.max(1, page);
  const [artifacts, total] = await Promise.all([
    listArtifacts(db, PER_PAGE, (safePage - 1) * PER_PAGE, maker || undefined),
    countArtifacts(db),
  ]);
  return { artifacts, maker, page: safePage, total };
}

export function WorkshopPage({ data, tint }: { data: WorkshopPageData; tint?: Tint }) {
  const { artifacts, maker, page, total } = data;
  const hasNext = artifacts.length === PER_PAGE;

  return (
    <BaseLayout
      tint={tint}
      title="Workshop — everything Kevin & Jenny have made — Living Core"
      description="Sketches, letters, maps and poems Kevin & Jenny have made on Sorrel Island — an open gallery, filterable by who made it."
      canonicalUrl={`https://livingcore.cc/workshop${maker ? `?maker=${maker}` : ''}`}
    >
      <div class="wrap">
        <h1>Workshop</h1>
        <p class="muted">{total} things made so far — sketches, letters, maps, poems.</p>

        <div class="chip-row">
          <a class="chip" href="/workshop" aria-current={maker === null ? 'true' : undefined}>All</a>
          <a class="chip" href="/workshop?maker=kevin" aria-current={maker === 'kevin' ? 'true' : undefined}>{BIOGRAPHIES.kevin.emoji} Kevin</a>
          <a class="chip" href="/workshop?maker=jenny" aria-current={maker === 'jenny' ? 'true' : undefined}>{BIOGRAPHIES.jenny.emoji} Jenny</a>
        </div>

        {artifacts.length === 0 ? (
          <p class="empty-note">Nothing made yet.</p>
        ) : (
          <div class="artifact-grid">
            {artifacts.map((a) => (
              <a class="artifact-card" href={`/made/${a.id}`} key={a.id}>
                {a.format === 'svg'
                  ? <img src={`/made/${a.id}.svg`} alt={a.title} loading="lazy" width="400" height="300" />
                  : <div class="paper">{a.content.slice(0, 160)}{a.content.length > 160 ? '…' : ''}</div>}
                <div class="artifact-meta">{a.title} · {BIOGRAPHIES[a.maker]?.name || a.maker} · day {a.day}</div>
              </a>
            ))}
          </div>
        )}

        <div class="pagination">
          {page > 1 ? <a href={`/workshop?${maker ? `maker=${maker}&` : ''}page=${page - 1}`}>← Newer</a> : <span></span>}
          {hasNext ? <a href={`/workshop?${maker ? `maker=${maker}&` : ''}page=${page + 1}`}>Older →</a> : <span></span>}
        </div>
      </div>
    </BaseLayout>
  );
}
