/** @jsxImportSource hono/jsx */
// /made/:id — one artifact's own page. (/made/:id.svg is served directly by
// the route, not through this component — see routes/views.tsx.)

import { BaseLayout } from '../BaseLayout';
import type { Tint } from '../chrome';
import { BIOGRAPHIES } from '../../world/bio';
import { getArtifact } from '../../world/store';
import type { ArtifactRow } from '../../world/types';

export interface MadePageData {
  artifact: ArtifactRow;
}

export async function fetchMadePageData(db: D1Database, id: number): Promise<MadePageData | null> {
  const artifact = await getArtifact(db, id);
  if (!artifact) return null;
  return { artifact };
}

export function MadePage({ data, tint }: { data: MadePageData; tint?: Tint }) {
  const { artifact: a } = data;
  const url = `https://livingcore.cc/made/${a.id}`;
  const maker = BIOGRAPHIES[a.maker];
  const description = a.format === 'svg'
    ? `A ${a.kind} made by ${maker.name} on day ${a.day} of Sorrel Island's island era.`
    : a.content.replace(/\s+/g, ' ').trim().slice(0, 155);

  return (
    <BaseLayout
      tint={tint}
      title={`${a.title.slice(0, 55)} — made by ${maker.name} — Living Core`}
      description={description}
      canonicalUrl={url}
      ogType="article"
      jsonLd={{
        '@type': 'CreativeWork',
        name: a.title,
        creator: { '@type': 'Person', name: maker.name },
        dateCreated: a.created_at,
        description,
        isPartOf: { '@id': 'https://livingcore.cc/#dataset' },
        url,
      }}
    >
      <div class="wrap">
        <p class="muted" style="margin:14px 0 0;"><a href="/workshop">← Workshop</a></p>
        <h1>{a.title}</h1>
        <p class="muted">{a.kind} · made by {maker.emoji} {maker.name} · day {a.day}{a.scene_id ? <> · <a href={`/scene/${a.scene_id}`}>the scene it happened in</a></> : null}</p>

        {a.format === 'svg' ? (
          <div class="artifact-card" style="max-width:520px;">
            <img src={`/made/${a.id}.svg`} alt={a.title} width="800" height="600" />
          </div>
        ) : (
          <div class="chapter-excerpt">
            <p class="prose" style="white-space:pre-wrap;">{a.content}</p>
          </div>
        )}

        <p class="muted" style="font-size:11px;margin-top:10px;">{a.model}</p>
      </div>
    </BaseLayout>
  );
}
