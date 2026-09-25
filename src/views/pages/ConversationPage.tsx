/** @jsxImportSource hono/jsx */
// /conversation/:slug — legacy talking-era conversations AND island scenes
// (island turns write into the same dialogue_turns table with turn_group =
// the scene id, per store.insertTurn). If `slug` is an island scene id, the
// route 301s to /scene/:id instead — that page has the richer, era-aware
// rendering (thought peeks, location, retry flags).

import { BaseLayout } from '../BaseLayout';
import type { Tint } from '../chrome';
import { faceFor } from '../agent-faces';
import { getScene } from '../../world/store';

interface ConversationPageData {
  slug: string;
  turns: any[];
  relatedMemories: any[];
  redirectToScene?: string;
}

export async function fetchConversationPageData(db: D1Database, slug: string): Promise<ConversationPageData | null> {
  // An island scene id looks like s<day>-<slot>-<seq> and lives in `scenes`.
  const scene = await getScene(db, slug);
  if (scene) return { slug, turns: [], relatedMemories: [], redirectToScene: scene.id };

  const turns = await db.prepare(
    'SELECT * FROM dialogue_turns WHERE turn_group = ? ORDER BY turn_number ASC LIMIT 400'
  ).bind(slug).all<any>();

  if (!turns.results || turns.results.length === 0) return null;

  const packets = await db.prepare(
    'SELECT id, type, content, primary_category FROM packets ORDER BY created_at DESC LIMIT 10'
  ).all<any>();

  return { slug, turns: turns.results, relatedMemories: packets.results || [] };
}

export function ConversationPage({ data, tint }: { data: ConversationPageData; tint?: Tint }) {
  const { slug, turns, relatedMemories } = data;
  const firstTurn = turns[0];
  const summary = (firstTurn?.content || 'Conversation between Kevin and Jenny').replace(/\s+/g, ' ').trim().slice(0, 160);
  const turnCount = turns.length;
  const agents = [...new Set(turns.map((t: any) => t.speaker))] as string[];
  const url = `https://livingcore.cc/conversation/${slug}`;

  return (
    <BaseLayout
      tint={tint}
      title={`${summary.slice(0, 65)}… — Kevin & Jenny — Living Core`}
      description={`Kevin & Jenny discuss: ${summary} — a ${turnCount}-turn conversation between two AI agents.`}
      canonicalUrl={url}
      ogType="article"
      jsonLd={{
        '@type': 'Article',
        headline: `Conversation: ${summary.slice(0, 100)}`,
        description: summary,
        articleSection: 'Conversation',
        wordCount: turns.reduce((n: number, t: any) => n + (t.content || '').split(/\s+/).length, 0),
        datePublished: firstTurn.created_at,
        dateModified: turns[turns.length - 1]?.created_at || firstTurn.created_at,
        author: agents.map((a: string) => ({ '@type': 'Person', name: a === 'kevin' ? 'Kevin' : 'Jenny' })),
        publisher: { '@id': 'https://www.lumorabuild.com/#organization' },
        isPartOf: { '@id': 'https://livingcore.cc/#dataset' },
        url,
      }}
    >
      <div class="wrap">
        <p class="muted" style="margin:14px 0 0;"><a href="/archive">← Archive</a></p>
        <h1>Conversation</h1>
        <p class="muted">{turnCount} turns · {agents.map((a) => a === 'kevin' ? 'Kevin' : 'Jenny').join(' & ')} · {firstTurn.created_at ? new Date(firstTurn.created_at.replace(' ', 'T') + 'Z').toLocaleDateString() : ''}</p>

        <div class="scene-card">
          {turns.map((turn: any) => <DialogueTurn key={turn.id} turn={turn} />)}
        </div>

        {relatedMemories.length > 0 && (
          <div class="section">
            <div class="section-head"><h2>Related memories</h2></div>
            <div class="artifact-grid">
              {relatedMemories.slice(0, 6).map((mem: any) => (
                <a href={`/memory/${mem.id}`} key={mem.id} class="artifact-card">
                  <div class="paper">
                    <span class="muted" style="font-size:10px;">{mem.type}</span>
                    <p>{(mem.content || '').slice(0, 120)}</p>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </BaseLayout>
  );
}

/** A silent island turn is stored as `(silent) <action>` (world/store.ts's
 *  insertTurn) — this legacy per-turn view reads dialogue_turns.content
 *  directly, so it has to unpack that marker itself rather than assume it's
 *  real speech. */
function splitContent(raw: string, speakerName: string): { say: string | null; action: string | null } {
  const silentMatch = raw.match(/^\(silent\)\s*(.*)$/i);
  if (silentMatch) return { say: null, action: silentMatch[1].trim() || null };
  const bare = raw.trim().replace(/^[([]+|[)\].]+$/g, '').trim().toLowerCase();
  if (bare === '' || bare === 'nothing' || bare === 'silence') return { say: null, action: null };
  return { say: raw, action: null };
}

function DialogueTurn({ turn }: { turn: any }) {
  const isKevin = turn.speaker === 'kevin';
  const timestamp = turn.created_at ? new Date(turn.created_at.replace(' ', 'T') + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const name = isKevin ? 'Kevin' : 'Jenny';
  const { say, action } = splitContent(turn.content || '', name);

  return (
    <div class={`turn ${isKevin ? 'kevin' : 'jenny'}`}>
      <div class="turn-head" style="align-items:center;">
        <span style="flex-shrink:0;">{faceFor(isKevin ? 'kevin' : 'jenny', { size: 28 })}</span>
        <span class="turn-name">{name}</span>
        <span class="turn-time">{timestamp}</span>
      </div>
      {say && <p class="turn-say">{say}</p>}
      {action && <p class="turn-do"><span class="turn-do-name">{name} — </span>{action}</p>}
      {!say && !action && <p class="turn-do turn-do-quiet">{name} is quiet for a moment.</p>}
      {turn.thoughts && (
        <details class="thought-peek">
          <summary>💭 reasoning</summary>
          <div class="thought-body">{turn.thoughts}</div>
        </details>
      )}
    </div>
  );
}
