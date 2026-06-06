/** @jsxImportSource hono/jsx */
import { BaseLayout } from '../BaseLayout';
import { KevinFace, JennyFace } from '../agent-faces';

interface ConversationPageData {
  slug: string;
  turns: any[];
  relatedMemories: any[];
}

export async function fetchConversationPageData(db: D1Database, slug: string): Promise<ConversationPageData | null> {
  const turns = await db.prepare(
    'SELECT * FROM dialogue_turns WHERE turn_group = ? ORDER BY turn_number ASC'
  ).bind(slug).all<any>();

  if (!turns.results || turns.results.length === 0) return null;

  // Find related packets mentioned in these turns
  const contentText = turns.results.map((t: any) => t.content || '').join(' ');
  const keywords = contentText.toLowerCase().split(/[^a-zA-Z]+/).filter((w: string) => w.length > 3).slice(0, 20);
  const uniqueWords = [...new Set(keywords)];

  const packets = await db.prepare(
    'SELECT id, type, content, primary_category FROM packets ORDER BY created_at DESC LIMIT 10'
  ).all<any>();

  return {
    slug,
    turns: turns.results,
    relatedMemories: packets.results || [],
  };
}

export function ConversationPage({ data }: { data: ConversationPageData }) {
  const { slug, turns, relatedMemories } = data;
  const firstTurn = turns[0];
  const summary = firstTurn?.content?.slice(0, 160) || 'Conversation between Kevin and Jenny';
  const turnCount = turns.length;
  const agents = [...new Set(turns.map((t: any) => t.speaker))];

  return (
    <BaseLayout
      title={`Conversation: ${summary.slice(0, 60)}... — Living Core`}
      description={`Kevin & Jenny discuss: ${summary} — ${turnCount} turns between ${agents.join(' and ')}.`}
      canonicalUrl={`https://livingcore.cc/conversation/${slug}`}
    >
      <div id="app" class="max-w-2xl mx-auto px-4 py-4 min-h-screen">
        {/* Header */}
        <header class="mb-4 border-b border-stone-800/50 pb-3">
          <a href="/" class="text-xs text-stone-600 hover:text-stone-300 mb-1 inline-block">← back to Living Core</a>
          <h1 class="text-lg font-bold tracking-tight mt-1">Conversation</h1>
          <p class="text-xs text-stone-600 mt-0.5">
            {turnCount} turns · {agents.join(' & ')} · {new Date(firstTurn.created_at || Date.now()).toLocaleDateString()}
          </p>
        </header>

        {/* Conversation Metadata */}
        <div class="glass-strong rounded-xl border border-stone-800/50 p-4 mb-4">
          <div class="flex items-center gap-3 text-xs text-stone-600">
            <span>💬 <span class="text-stone-300">{turnCount}</span> turns</span>
            <span>🎙️ <span class="text-stone-300">{agents.join(', ')}</span></span>
            <span>📅 {new Date(firstTurn.created_at || Date.now()).toLocaleDateString()}</span>
          </div>
        </div>

        {/* Dialogue Timeline */}
        <div class="space-y-3 mb-8">
          {(turns as any[]).map((turn) => (
            <DialogueTurn key={turn.id} turn={turn} />
          ))}
        </div>

        {/* Related Memories */}
        {relatedMemories.length > 0 && (
          <div class="mb-8">
            <h2 class="text-sm font-medium text-stone-300 mb-3">Related Memories</h2>
            <div class="grid grid-cols-2 gap-3">
              {relatedMemories.slice(0, 6).map((mem: any) => (
                <a href={`/memory/${mem.id}`} key={mem.id}
                  class="glass-warm rounded-xl border border-stone-800/50 p-3 card-hover block"
                >
                  <span class="text-[10px] text-stone-600">{mem.type} · {mem.agent}</span>
                  <p class="text-xs text-stone-300 mt-1 line-clamp-2">{escapeHtml(mem.content || '').slice(0, 120)}</p>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Structured data for SEO */}
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Conversation',
            'name': `Conversation: ${summary.slice(0, 100)}`,
            'description': summary,
            'numberOfTurns': turnCount,
            'dateCreated': firstTurn.created_at,
            'url': `https://livingcore.cc/conversation/${slug}`,
          })}
        </script>
      </div>
    </BaseLayout>
  );
}

function DialogueTurn({ turn }: { turn: any }) {
  const isKevin = turn.speaker === 'kevin';
  const accent = isKevin ? 'rgb(245, 158, 11)' : 'rgb(244, 63, 94)';
  const bgAccent = isKevin ? 'rgba(245, 158, 11, 0.06)' : 'rgba(244, 63, 94, 0.06)';
  const timestamp = turn.created_at ? new Date(turn.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div class="glass-warm rounded-xl p-3 border" style={{ borderColor: `${isKevin ? 'rgba(245, 158, 11, 0.2)' : 'rgba(244, 63, 94, 0.2)'}`, background: bgAccent }}>
      <div class="flex items-start gap-3">
        <div class="flex-shrink-0 mt-0.5">
          {isKevin ? <KevinFace mood="neutral" speaking={false} size={36} showLabel={false} /> : <JennyFace mood="neutral" speaking={false} size={36} showLabel={false} />}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-sm font-semibold" style={{ color: accent }}>
              {isKevin ? 'Kevin' : 'Jenny'}
              <span class="font-normal text-[10px] text-stone-600 ml-1">{isKevin ? 'The Grounder' : 'The Weaver'}</span>
            </span>
            <span class="text-[10px] text-stone-600">{timestamp}</span>
          </div>
          <p class="text-sm text-stone-300 leading-relaxed">{escapeHtml(turn.content || '')}</p>
          {turn.thoughts && (
            <div class="mt-2 text-[11px] text-stone-600 bg-stone-800/30 rounded-lg p-3 whitespace-pre-wrap leading-relaxed font-mono">
              {escapeHtml(turn.thoughts || '')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
