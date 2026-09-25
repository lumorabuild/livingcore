/** @jsxImportSource hono/jsx */
// /archive — legacy (pre-island) + island-scene conversation index, paginated.
//
// Fix (spec §9): the old query GROUP BY'd all ~72k rows on every render with
// no LIMIT/OFFSET. This bounds it: an index-friendly "newest N groups" query
// via a subquery on MAX(id) per turn_group, LIMIT/OFFSET on the GROUPS, then
// one more query for just those groups' aggregates.

import { BaseLayout } from '../BaseLayout';
import type { Tint } from '../chrome';

const PER_PAGE = 50;

/** A silent island turn is stored as `(silent) <action>` (see world/store.ts's
 *  insertTurn), and the model can also write the literal word "nothing" as
 *  its own SAY instead of leaving it blank. Neither reads as a preview of
 *  what was actually SAID, so this softens both into one honest line rather
 *  than leaking an internal marker onto a public page. */
function previewLine(raw: string): string {
  const silentMatch = raw.match(/^\(silent\)\s*(.*)$/i);
  if (silentMatch) return `Quiet — ${silentMatch[1].trim() ? lowerFirst(silentMatch[1].trim()) : 'no words, no action'}`;
  const bare = raw.trim().replace(/^[([]+|[)\].]+$/g, '').trim().toLowerCase();
  if (bare === '' || bare === 'nothing' || bare === 'silence') return 'A quiet turn — nothing said.';
  return raw;
}
function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

interface ConversationRow {
  slug: string;
  turnCount: number;
  agents: string[];
  date: string;
  preview: string;
}

export interface ArchivePageData {
  conversations: ConversationRow[];
  totalTurns: number;
  page: number;
  hasNext: boolean;
}

export async function fetchArchivePageData(db: D1Database, page: number): Promise<ArchivePageData> {
  const safePage = Math.max(1, page);
  const offset = (safePage - 1) * PER_PAGE;

  // Newest PER_PAGE+1 groups by their latest turn id — bounded, no full scan.
  const groupIds = await db.prepare(
    `SELECT turn_group, MAX(id) AS last_id FROM dialogue_turns
     WHERE turn_group IS NOT NULL AND turn_group != ''
     GROUP BY turn_group
     ORDER BY last_id DESC
     LIMIT ? OFFSET ?`
  ).bind(PER_PAGE + 1, offset).all<{ turn_group: string; last_id: number }>();

  const groups = (groupIds.results || []).slice(0, PER_PAGE);
  const hasNext = (groupIds.results || []).length > PER_PAGE;

  const conversations: ConversationRow[] = [];
  for (const g of groups) {
    const agg = await db.prepare(
      `SELECT COUNT(*) as turn_count, GROUP_CONCAT(DISTINCT speaker) as speakers,
              MIN(created_at) as first_date, MIN(content) as first_content
       FROM dialogue_turns WHERE turn_group = ?`
    ).bind(g.turn_group).first<{ turn_count: number; speakers: string; first_date: string; first_content: string }>();
    if (!agg) continue;
    conversations.push({
      slug: g.turn_group,
      turnCount: agg.turn_count,
      agents: (agg.speakers || '').split(',').filter(Boolean),
      date: agg.first_date || '',
      preview: previewLine(agg.first_content || '').slice(0, 200),
    });
  }

  const totalTurns = page === 1
    ? (await db.prepare('SELECT COUNT(*) as count FROM dialogue_turns').first<{ count: number }>())?.count || 0
    : -1; // only computed on page 1 — an exact COUNT(*) on every page would defeat the point of paginating

  return { conversations, totalTurns, page: safePage, hasNext };
}

export function ArchivePage({ data, tint }: { data: ArchivePageData; tint?: Tint }) {
  const { conversations, totalTurns, page, hasNext } = data;

  return (
    <BaseLayout
      tint={tint}
      title={page > 1 ? `Archive — page ${page} — Living Core` : 'Archive — every conversation — Living Core'}
      description="Every conversation between Kevin & Jenny, from the talking era through the island era — an open (CC0) dataset."
      canonicalUrl={`https://livingcore.cc/archive${page > 1 ? `?page=${page}` : ''}`}
    >
      <div class="wrap">
        <h1>Archive</h1>
        <p class="muted">{totalTurns >= 0 ? `${totalTurns} total turns · ` : ''}page {page}</p>

        {conversations.length === 0 ? (
          <p class="empty-note">No conversations yet.</p>
        ) : (
          <div class="timeline">
            {conversations.map((conv) => (
              <div class="tl-item scene" key={conv.slug}>
                <span class="tl-dot"></span>
                <div class="tl-body">
                  <a href={`/conversation/${conv.slug}`}>{conv.turnCount} turns · {conv.agents.map((a) => a === 'kevin' ? 'Kevin' : 'Jenny').join(' & ')}</a>
                  <div class="tl-meta">{conv.date ? new Date(conv.date.replace(' ', 'T') + 'Z').toLocaleDateString() : ''}</div>
                  <div class="tl-summary">{conv.preview}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div class="pagination">
          {page > 1 ? <a href={`/archive?page=${page - 1}`}>← Newer</a> : <span></span>}
          {hasNext ? <a href={`/archive?page=${page + 1}`}>Older →</a> : <span></span>}
        </div>
      </div>
    </BaseLayout>
  );
}
