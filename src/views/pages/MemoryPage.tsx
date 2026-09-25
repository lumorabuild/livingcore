/** @jsxImportSource hono/jsx */
// /memory/:id — a single packet (pre-island shared memory). Fix (spec §9):
// `packets` has no `agent` or `keywords` column — the old page rendered both,
// always as undefined. Only real columns (type, content, primary_category,
// secondary_categories, strength, created_at, last_updated) are shown.

import { BaseLayout } from '../BaseLayout';
import type { Tint } from '../chrome';

interface MemoryPageData {
  packet: any;
  connections: any[];
  connectedPackets: any[];
}

export async function fetchMemoryPageData(db: D1Database, id: string): Promise<MemoryPageData | null> {
  const packet = await db.prepare('SELECT * FROM packets WHERE id = ?').bind(id).first<any>();
  if (!packet) return null;

  const connections = await db.prepare(
    'SELECT * FROM connections WHERE source_id = ? OR target_id = ? LIMIT 50'
  ).bind(id, id).all<any>();

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

export function MemoryPage({ data, tint }: { data: MemoryPageData; tint?: Tint }) {
  const { packet, connections, connectedPackets } = data;
  const timestamp = packet.created_at ? new Date(packet.created_at.replace(' ', 'T') + 'Z').toLocaleString() : '';
  const url = `https://livingcore.cc/memory/${packet.id}`;
  const summary = (packet.content || '').replace(/\s+/g, ' ').trim();

  return (
    <BaseLayout
      tint={tint}
      title={`${packet.type}: ${summary.slice(0, 70)}… — Living Core`}
      description={`A ${packet.type} in the shared memory archive: ${summary.slice(0, 200)}`}
      canonicalUrl={url}
      ogType="article"
      jsonLd={{
        '@type': 'CreativeWork',
        name: `${packet.type}: ${summary.slice(0, 100)}`,
        description: summary.slice(0, 300),
        dateCreated: packet.created_at,
        dateModified: packet.last_updated || packet.created_at,
        isPartOf: { '@id': 'https://livingcore.cc/#dataset' },
        url,
      }}
    >
      <div class="wrap">
        <p class="muted" style="margin:14px 0 0;"><a href="/">← Living Core</a></p>

        <div class="chapter-excerpt">
          <span class="kind-pill">{packet.type}</span>
          {packet.primary_category && <span class="muted" style="font-size:11px;">{packet.primary_category}</span>}
          <h1 style="margin-top:10px;">{summary}</h1>
          <p class="muted" style="font-size:11.5px;">
            Created: {timestamp}
            {' · '}Connections: {connections.length}
          </p>
        </div>

        {connectedPackets.length > 0 && (
          <div class="section">
            <div class="section-head"><h2>Connections ({connectedPackets.length})</h2></div>
            <div class="notebook-list">
              {connectedPackets.map((cp: any) => (
                <a href={`/memory/${cp.id}`} key={cp.id} class="notebook-item" style="display:block;">
                  <span class="kind-pill">{cp.type}</span>{(cp.content || '').slice(0, 160)}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </BaseLayout>
  );
}
