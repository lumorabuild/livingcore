/** @jsxImportSource hono/jsx */
// /days — chapter index, paginated. Bounded LIMIT/OFFSET query via store.listChapters.

import { BaseLayout } from '../BaseLayout';
import type { Tint } from '../chrome';
import { listChapters } from '../../world/store';
import type { ChapterRow } from '../../world/types';

const PER_PAGE = 20;

export interface DaysPageData {
  chapters: ChapterRow[];
  page: number;
  hasNext: boolean;
}

export async function fetchDaysPageData(db: D1Database, page: number): Promise<DaysPageData> {
  const safePage = Math.max(1, page);
  const chapters = await listChapters(db, PER_PAGE + 1, (safePage - 1) * PER_PAGE);
  return { chapters: chapters.slice(0, PER_PAGE), page: safePage, hasNext: chapters.length > PER_PAGE };
}

export function DaysPage({ data, tint }: { data: DaysPageData; tint?: Tint }) {
  const { chapters, page, hasNext } = data;
  return (
    <BaseLayout
      tint={tint}
      title={page > 1 ? `Days — page ${page} — Living Core` : 'Days — the chapters of Sorrel Island — Living Core'}
      description="Every day on Sorrel Island, written up as a chapter once it closes — Kevin and Jenny's island era, one day at a time."
      canonicalUrl={`https://livingcore.cc/days${page > 1 ? `?page=${page}` : ''}`}
    >
      <div class="wrap">
        <h1>Days</h1>
        <p class="muted">Each day becomes a chapter once it closes — written from that day's scenes, events and what was made.</p>

        {chapters.length === 0 ? (
          <p class="empty-note">No chapters yet — the first is written at the end of day 1.</p>
        ) : (
          <div class="timeline">
            {chapters.map((c) => {
              const excerpt = c.body.replace(/\s+/g, ' ').trim().slice(0, 180);
              return (
                <div class="tl-item scene" key={c.day}>
                  <span class="tl-dot"></span>
                  <div class="tl-body">
                    <a href={`/day/${c.day}`}>Day {c.day} — {c.title}</a>
                    <div class="tl-summary">{excerpt}{excerpt.length >= 180 ? '…' : ''}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div class="pagination">
          {page > 1 ? <a href={`/days?page=${page - 1}`}>← Newer</a> : <span></span>}
          {hasNext ? <a href={`/days?page=${page + 1}`}>Older →</a> : <span></span>}
        </div>
      </div>
    </BaseLayout>
  );
}
