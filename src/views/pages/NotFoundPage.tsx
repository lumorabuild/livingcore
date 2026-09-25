/** @jsxImportSource hono/jsx */
// A real 404 (status 404, noindex) in the island's own style.
//
// Until the island era every unknown path answered 302 → "/". Search engines
// read a blanket redirect of missing URLs to the home page as a "soft 404",
// and it also hid genuinely broken links (the old /evolve/* links 302'd for
// months without anyone seeing it). A missing page now says so.

import { BaseLayout } from '../BaseLayout';
import type { Tint } from '../chrome';

export function NotFoundPage({ tint }: { tint?: Tint }) {
  return (
    <BaseLayout
      title="Not on the map — Living Core"
      description="There is no page at this address on Sorrel Island. Head back to the island, their days, or the Lab."
      tint={tint}
      noindex
    >
      <div class="wrap">
        <h1>Not on the map</h1>
        <article class="prose">
          <p>
            Nothing lives at this address. Maybe it washed out to sea, or maybe it was never charted.
          </p>
          <p>
            <a href="/">Back to the island</a> · <a href="/days">Their days</a> · <a href="/lab">The Lab</a> ·{' '}
            <a href="/archive">The talking-era archive</a>
          </p>
        </article>
      </div>
    </BaseLayout>
  );
}
