/** @jsxImportSource hono/jsx */
// /notebook — what Kevin & Jenny have learned, grouped by kind.

import { BaseLayout } from '../BaseLayout';
import type { Tint } from '../chrome';
import { BIOGRAPHIES } from '../../world/bio';
import { listNotebook, countNotebook } from '../../world/store';
import type { NotebookRow } from '../../world/types';

const PER_PAGE = 60;
const KIND_LABEL: Record<string, string> = {
  discovery: 'Discoveries', lesson: 'Lessons learned', species: 'Species', recipe: 'Recipes', fact: 'Facts',
};
const KIND_ORDER = ['discovery', 'lesson', 'species', 'recipe', 'fact'];

export interface NotebookPageData {
  entries: NotebookRow[];
  page: number;
  total: number;
}

export async function fetchNotebookPageData(db: D1Database, page: number): Promise<NotebookPageData> {
  const safePage = Math.max(1, page);
  const [entries, total] = await Promise.all([
    listNotebook(db, PER_PAGE, (safePage - 1) * PER_PAGE),
    countNotebook(db),
  ]);
  return { entries, page: safePage, total };
}

export function NotebookPage({ data, tint }: { data: NotebookPageData; tint?: Tint }) {
  const { entries, page, total } = data;
  const hasNext = entries.length === PER_PAGE;

  const groups = new Map<string, NotebookRow[]>();
  for (const e of entries) {
    if (!groups.has(e.kind)) groups.set(e.kind, []);
    groups.get(e.kind)!.push(e);
  }
  const orderedKinds = [...KIND_ORDER.filter((k) => groups.has(k)), ...[...groups.keys()].filter((k) => !KIND_ORDER.includes(k))];

  return (
    <BaseLayout
      tint={tint}
      title="Notebook — what Kevin & Jenny have learned — Living Core"
      description="Sorrel Island's shared notebook: discoveries, lessons, species and facts Kevin and Jenny have recorded as they learn the island."
      canonicalUrl={`https://livingcore.cc/notebook${page > 1 ? `?page=${page}` : ''}`}
    >
      <div class="wrap">
        <h1>Notebook</h1>
        <p class="muted">{total} entries recorded so far — their shared, growing knowledge of the island.</p>

        {entries.length === 0 ? (
          <p class="empty-note">Nothing recorded yet.</p>
        ) : (
          orderedKinds.map((kind) => (
            <div class="section" key={kind}>
              <div class="section-head"><h2>{KIND_LABEL[kind] || kind}</h2></div>
              <div class="notebook-list">
                {groups.get(kind)!.map((n) => (
                  <div class="notebook-item" key={n.id}>
                    {n.content}
                    <div class="nb-meta">day {n.day} · {n.author === 'both' ? 'both' : BIOGRAPHIES[n.author as 'kevin' | 'jenny']?.name || n.author}{n.location ? ` · ${n.location}` : ''}</div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}

        <div class="pagination">
          {page > 1 ? <a href={`/notebook?page=${page - 1}`}>← Newer</a> : <span></span>}
          {hasNext ? <a href={`/notebook?page=${page + 1}`}>Older →</a> : <span></span>}
        </div>
      </div>
    </BaseLayout>
  );
}
