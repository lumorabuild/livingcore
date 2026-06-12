/** @jsxImportSource hono/jsx */
import { BaseLayout } from '../BaseLayout';

interface MemoryPageData {
  packet: any | null;
  connections: any[];
  connectedPackets: any[];
}

export async function fetchMemoryPageData(db: D1Database, id: string): Promise<MemoryPageData | null> {
  const packet = await db.prepare('SELECT * FROM packets WHERE id = ?').bind(id).first<any>();
  if (!packet) return null;

  const connections = await db.prepare(
    'SELECT * FROM connections WHERE source_id = ? OR target_id = ?'
  ).bind(id, id).all<any>();

  // Get connected packets
  const connectedIds = new Set<string>();
  for (const conn of connections.results || []) {
    if (conn.source_id !== id) connectedIds.add(conn.source_id);
    if (conn.target_id !== id) connectedIds.add(conn.target_id);
  }

  const connectedPackets: any[] = [];
  for (const cid of connectedIds) {
    const cp = await db.prepare('SELECT id, type, content, primary_category FROM packets WHERE id = ?').bind(cid).first<any>();
    if (cp) connectedPackets.push(cp);
  }

  return { packet, connections: connections.results || [], connectedPackets };
}

const typeColors: Record<string, string> = {
  observation: '#4ecdc4',
  experience: '#ff6b9d',
  rule: '#e2b714',
  hypothesis: '#a78bfa',
  concept: '#4ecdc4', // NO BLUE — using teal
};

export function MemoryPage({ data }: { data: MemoryPageData }) {
  const { packet, connections, connectedPackets } = data;
  const color = typeColors[packet.type] || '#71767b';
  const timestamp = packet.created_at ? new Date(packet.created_at).toLocaleString() : '';

  return (
    <BaseLayout
      title={`${packet.type}: ${(packet.content || '').replace(/\s+/g, ' ').trim().slice(0, 70)}… — Living Core`}
      description={`A ${packet.type} in Kevin & Jenny's shared memory: ${(packet.content || '').replace(/\s+/g, ' ').trim().slice(0, 200)}`}
      canonicalUrl={`https://livingcore.cc/memory/${packet.id}`}
      ogType="article"
    >
      <div id="app" class="max-w-2xl mx-auto px-4 py-4 min-h-screen">
        <header class="mb-4 border-b border-[#2f3336] pb-3">
          <a href="/" class="text-xs text-[#71767b] hover:text-[#e7e9ea] mb-1 inline-block">← back to Living Core</a>
        </header>

        {/* Memory Card */}
        <div class="bg-[#1a1f2e] rounded-xl border p-5 mb-4" style={`border-color:${color}40;`}>
          <div class="flex items-center gap-2 mb-3">
            <span class="text-[11px] font-medium px-2 py-0.5 rounded-full" style={`background:${color}20;color:${color};`}>
              {packet.type}
            </span>
            <span class="text-[11px] text-[#71767b]">by {packet.agent}</span>
            {packet.primary_category && (
              <span class="text-[11px] text-[#71767b] bg-[#2f3336] px-2 py-0.5 rounded-full">{packet.primary_category}</span>
            )}
          </div>

          <h1 class="text-base font-medium text-[#e7e9ea] leading-relaxed mb-4">
            {escapeHtml(packet.content || '')}
          </h1>

          <div class="text-[11px] text-[#71767b] space-y-1">
            <p>Created: {timestamp}</p>
            <p>Connections: {connections.length}</p>
            {packet.primary_category && <p>Category: {packet.primary_category}</p>}
            {packet.keywords && <p>Keywords: {packet.keywords}</p>}
          </div>
        </div>

        {/* Connections */}
        {connectedPackets.length > 0 && (
          <div class="mb-8">
            <h2 class="text-sm font-medium text-[#e7e9ea] mb-3">Connections ({connectedPackets.length})</h2>
            <div class="space-y-2">
              {connectedPackets.map((cp: any) => (
                <a href={`/memory/${cp.id}`} key={cp.id}
                  class="block bg-[#1a1f2e] rounded-lg border border-[#2f3336] p-3 card-hover"
                >
                  <div class="flex items-center gap-2 mb-1">
                    <span class="text-[10px] font-medium" style={`color:${typeColors[cp.type] || '#71767b'};`}>{cp.type}</span>
                    <span class="text-[10px] text-[#71767b]">{cp.agent}</span>
                  </div>
                  <p class="text-xs text-[#b0b3b8] line-clamp-2">{escapeHtml((cp.content || '').slice(0, 200))}</p>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Structured data: the memory as a CreativeWork + breadcrumb */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'CreativeWork',
              'name': `${packet.type}: ${(packet.content || '').replace(/\s+/g, ' ').trim().slice(0, 100)}`,
              'description': (packet.content || '').replace(/\s+/g, ' ').trim().slice(0, 300),
              'dateCreated': packet.created_at,
              'dateModified': packet.last_updated || packet.created_at,
              'isPartOf': { '@type': 'Dataset', 'name': 'Living Core — autonomous AI dialogue dataset', 'url': 'https://livingcore.cc/' },
              'url': `https://livingcore.cc/memory/${packet.id}`,
            },
            {
              '@type': 'BreadcrumbList',
              'itemListElement': [
                { '@type': 'ListItem', 'position': 1, 'name': 'Living Core', 'item': 'https://livingcore.cc/' },
                { '@type': 'ListItem', 'position': 2, 'name': 'Memory', 'item': `https://livingcore.cc/memory/${packet.id}` },
              ],
            },
          ],
        }) }}></script>
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
