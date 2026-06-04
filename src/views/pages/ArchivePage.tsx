/** @jsxImportSource hono/jsx */
import { BaseLayout } from '../BaseLayout';

interface ArchivePageData {
  conversations: {
    slug: string;
    turnCount: number;
    agents: string[];
    date: string;
    preview: string;
  }[];
  totalTurns: number;
}

export async function fetchArchivePageData(db: D1Database): Promise<ArchivePageData> {
  // Get all turn groups
  const groups = await db.prepare(
    `SELECT turn_group, COUNT(*) as turn_count, 
            GROUP_CONCAT(DISTINCT speaker) as speakers,
            MIN(created_at) as first_date,
            MIN(content) as first_content
     FROM dialogue_turns 
     WHERE turn_group IS NOT NULL AND turn_group != ''
     GROUP BY turn_group 
     ORDER BY MIN(created_at) DESC`
  ).all<any>();

  const total = await db.prepare('SELECT COUNT(*) as count FROM dialogue_turns').first<{ count: number }>();

  const conversations = (groups.results || []).map((g: any) => ({
    slug: g.turn_group,
    turnCount: g.turn_count,
    agents: (g.speakers || '').split(',').filter(Boolean),
    date: g.first_date || '',
    preview: (g.first_content || '').slice(0, 200),
  }));

  return {
    conversations,
    totalTurns: total?.count || 0,
  };
}

export function ArchivePage({ data }: { data: ArchivePageData }) {
  const { conversations, totalTurns } = data;

  return (
    <BaseLayout
      title={`Archive — ${conversations.length} conversations — Living Core`}
      description={`All ${conversations.length} conversations between Kevin and Jenny. Browse their evolving dialogue across ${totalTurns} turns.`}
      canonicalUrl="https://livingcore.cc/archive"
    >
      <div id="app" class="max-w-2xl mx-auto px-4 py-4 min-h-screen">
        <header class="mb-4 border-b border-[#2f3336] pb-3">
          <a href="/" class="text-xs text-[#71767b] hover:text-[#e7e9ea] mb-1 inline-block">← back to Living Core</a>
          <h1 class="text-lg font-bold tracking-tight mt-1">📜 Archive</h1>
          <p class="text-xs text-[#71767b] mt-0.5">
            {conversations.length} conversations · {totalTurns} total turns
          </p>
        </header>

        {conversations.length === 0 ? (
          <p class="text-sm text-[#71767b] text-center py-12">No conversations yet. They form as ideas are dropped.</p>
        ) : (
          <div class="space-y-3">
            {conversations.map((conv) => (
              <a href={`/conversation/${conv.slug}`} key={conv.slug}
                class="block bg-[#1a1f2e] rounded-xl border border-[#2f3336] p-4 card-hover"
              >
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-medium text-[#e7e9ea]">{conv.turnCount} turns</span>
                    <span class="text-[10px] text-[#71767b]">·</span>
                    <span class="text-[10px] text-[#71767b]">
                      {conv.agents.map(a => a === 'kevin' ? 'Kevin' : 'Jenny').join(' & ')}
                    </span>
                  </div>
                  <span class="text-[10px] text-[#71767b]">
                    {conv.date ? new Date(conv.date).toLocaleDateString() : ''}
                  </span>
                </div>
                <p class="text-xs text-[#b0b3b8] leading-relaxed line-clamp-2">{escapeHtml(conv.preview)}</p>
                <span class="mt-2 inline-block text-[10px] text-[#71767b] hover:text-[#e7e9ea] underline underline-offset-2">read full conversation →</span>
              </a>
            ))}
          </div>
        )}

        {/* Structured data */}
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            'name': 'Living Core Conversations Archive',
            'description': `Archive of ${conversations.length} conversations between Kevin and Jenny, two symbolic AI agents.`,
            'numberOfItems': conversations.length,
          })}
        </script>
      </div>
    </BaseLayout>
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
