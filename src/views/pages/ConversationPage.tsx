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
  const summary = (firstTurn?.content || 'Conversation between Kevin and Jenny')
    .replace(/\s+/g, ' ').trim().slice(0, 160);
  const turnCount = turns.length;
  const agents = [...new Set(turns.map((t: any) => t.speaker))];
  const url = `https://livingcore.cc/conversation/${slug}`;

  return (
    <BaseLayout
      title={`${summary.slice(0, 65)}… — Kevin & Jenny — Living Core`}
      description={`Kevin & Jenny discuss: ${summary} — a ${turnCount}-turn conversation between two AI agents.`}
      canonicalUrl={url}
      ogType="article"
    >
      <div id="app" class="max-w-2xl mx-auto px-4 py-4 min-h-screen">
        {/* Header */}
        <header class="mb-4 border-b border-[#2f3336] pb-3">
          <a href="/" class="text-xs text-[#71767b] hover:text-[#e7e9ea] mb-1 inline-block">← back to Living Core</a>
          <h1 class="text-lg font-bold tracking-tight mt-1">Conversation</h1>
          <p class="text-xs text-[#71767b] mt-0.5">
            {turnCount} turns · {agents.join(' & ')} · {new Date(firstTurn.created_at || Date.now()).toLocaleDateString()}
          </p>
        </header>

        {/* Conversation Metadata */}
        <div class="bg-[#1a1f2e] rounded-xl border border-[#2f3336] p-4 mb-4">
          <div class="flex items-center gap-3 text-xs text-[#71767b]">
            <span>💬 <span class="text-[#e7e9ea]">{turnCount}</span> turns</span>
            <span>🎙️ <span class="text-[#e7e9ea]">{agents.join(', ')}</span></span>
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
            <h2 class="text-sm font-medium text-[#e7e9ea] mb-3">Related Memories</h2>
            <div class="grid grid-cols-2 gap-3">
              {relatedMemories.slice(0, 6).map((mem: any) => (
                <a href={`/memory/${mem.id}`} key={mem.id}
                  class="bg-[#1a1f2e] rounded-xl border border-[#2f3336] p-3 card-hover block"
                >
                  <span class="text-[10px] text-[#71767b]">{mem.type} · {mem.agent}</span>
                  <p class="text-xs text-[#b0b3b8] mt-1 line-clamp-2">{escapeHtml(mem.content || '').slice(0, 120)}</p>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Structured data for SEO: the conversation as an Article + breadcrumb trail */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'Article',
              'headline': `Conversation: ${summary.slice(0, 100)}`,
              'description': summary,
              'articleSection': 'Conversation',
              'wordCount': turns.reduce((n: number, t: any) => n + (t.content || '').split(/\s+/).length, 0),
              'datePublished': firstTurn.created_at,
              'dateModified': turns[turns.length - 1]?.created_at || firstTurn.created_at,
              'author': agents.map((a: string) => ({ '@type': 'Person', 'name': a === 'kevin' ? 'Kevin' : 'Jenny' })),
              'publisher': { '@type': 'Organization', 'name': 'LumoRabuild', 'url': 'https://www.lumorabuild.com/' },
              'isPartOf': { '@type': 'Dataset', 'name': 'Living Core — autonomous AI dialogue dataset', 'url': 'https://livingcore.cc/' },
              'url': url,
              'mainEntityOfPage': url,
            },
            {
              '@type': 'BreadcrumbList',
              'itemListElement': [
                { '@type': 'ListItem', 'position': 1, 'name': 'Living Core', 'item': 'https://livingcore.cc/' },
                { '@type': 'ListItem', 'position': 2, 'name': 'Archive', 'item': 'https://livingcore.cc/archive' },
                { '@type': 'ListItem', 'position': 3, 'name': 'Conversation', 'item': url },
              ],
            },
          ],
        }) }}></script>
      </div>
    </BaseLayout>
  );
}

function DialogueTurn({ turn }: { turn: any }) {
  const isKevin = turn.speaker === 'kevin';
  const accent = isKevin ? '#4ecdc4' : '#ff6b9d';
  const bgAccent = isKevin ? 'rgba(78,205,196,0.06)' : 'rgba(255,107,157,0.06)';
  const timestamp = turn.created_at ? new Date(turn.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div class="rounded-xl p-3 border" style={`border-color:${accent}20;background:${bgAccent};`}>
      <div class="flex items-start gap-3">
        <div class="flex-shrink-0 mt-0.5">
          {isKevin ? <KevinFace mood="neutral" speaking={false} size={36} showLabel={false} /> : <JennyFace mood="neutral" speaking={false} size={36} showLabel={false} />}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-sm font-semibold" style={`color:${accent};`}>
              {isKevin ? 'Kevin' : 'Jenny'}
              <span class="font-normal text-[10px] text-[#71767b] ml-1">{isKevin ? 'husband' : 'wife'}</span>
            </span>
            <span class="text-[10px] text-[#71767b]">{timestamp}</span>
          </div>
          <p class="text-sm text-[#b0b3b8] leading-relaxed">{escapeHtml(turn.content || '')}</p>
          {turn.thoughts && (
            <div class="mt-2 text-[11px] text-[#71767b] bg-[#202327] rounded-lg p-3 whitespace-pre-wrap leading-relaxed font-mono">
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
