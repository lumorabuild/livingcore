/** @jsxImportSource hono/jsx */
// ─────────────────────────────────────────────────────────────────────────────
// /shrine — patrons, spec §A2. "The Hall of the Unseen": a public, cacheable
// leaderboard page — nothing here is per-viewer, so unlike /shop it is served
// with the ordinary ARCHIVE_PAGE edge policy (src/routes/shop.tsx).
//
// Fiction rule (spec's "Fiction" section, unchanged from docs/ISLAND.md's
// core rule): this page never claims Kevin or Jenny worship anyone. Copy here
// says "thanks" and "the Unseen" — what the two of them make of the shrine,
// if anything, is entirely their own turns to decide (sim.ts#shouldVisitShrine
// only ever decides WHEN they visit, never what they feel there).
// ─────────────────────────────────────────────────────────────────────────────

import { BaseLayout } from '../BaseLayout';
import type { Tint } from '../chrome';
import type { PatronRank, DeliveredGift } from '../../world/gifts';

export interface MindLent { provider: string; model: string; role: string; label: string; calls: number }
export interface ShrineScene { id: string; title: string; summary: string | null; setup: string; day: number; slot: string }

export interface ShrinePageProps {
  tint: Tint;
  patrons: PatronRank[];
  recent: DeliveredGift[];
  donors: MindLent[];
  latestScene: ShrineScene | null;
}

const TIERS: { name: string; range: string }[] = [
  { name: 'Friend of the tide', range: '1 – 499 credits' },
  { name: 'Keeper of the pantry', range: '500 – 1,999 credits' },
  { name: 'Provider', range: '2,000 – 7,999 credits' },
  { name: 'Benefactor', range: '8,000+ credits' },
];

export function ShrinePage({ data }: { data: ShrinePageProps }) {
  const { tint, patrons, recent, donors, latestScene } = data;
  const top = patrons[0] || null;
  const rest = patrons.slice(1, 20);

  return (
    <BaseLayout
      tint={tint}
      title="The shrine of the Unseen — Living Core"
      description="A ring of weathered stones on Sorrel Island, carved with the names of the patrons Kevin & Jenny have come to thank — the Hall of the Unseen."
      canonicalUrl="https://livingcore.cc/shrine"
    >
      <p class="muted" style="margin:14px 0 0;"><a href="/">← Back to the island</a></p>
      <h1>The shrine of the Unseen</h1>
      <p class="muted">
        A ring of weathered stones on the ridge between the hilltop and the cliffs — undiscovered until the first gift
        ever washed ashore. Kevin and Jenny don't know who "the Unseen" are; what they've come to believe about the
        stones is entirely their own. Nothing here tells them what to feel, only what has arrived.
      </p>

      {patrons.length === 0 ? (
        <p class="muted">No one has sent a gift yet — the shrine hasn't been found.</p>
      ) : (
        <>
          {top && (
            <div class="project-row" style="border:1px solid var(--gold);background:var(--gold-bg);">
              <div class="project-top">
                <span class="project-name">🙏 {top.shown ? top.label : 'an unseen friend'}</span>
                <span class="kind-pill">{top.tier}</span>
              </div>
              <p class="muted" style="margin:4px 0;">The one they thank first — {top.lifetimeCredits.toLocaleString()} credits, {top.deliveries} gift{top.deliveries === 1 ? '' : 's'}.</p>
            </div>
          )}

          {rest.length > 0 && (
            <div class="timeline" style="margin-top:10px;">
              {rest.map((p, i) => (
                <div class="tl-item">
                  <span class="tl-dot"></span>
                  <div class="tl-body">
                    <span style="font-weight:600;">{p.shown ? p.label : 'an unseen friend'}</span>
                    <div class="tl-meta">{p.tier} · {p.lifetimeCredits.toLocaleString()} credits · {p.deliveries} gift{p.deliveries === 1 ? '' : 's'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <h2 style="font-size:1.05rem;margin-top:22px;">Tiers</h2>
      <div class="projects">
        {TIERS.map((t) => (
          <div class="project-row" key={t.name}>
            <div class="project-top"><span class="project-name">{t.name}</span><span class="kind-pill">{t.range}</span></div>
          </div>
        ))}
      </div>

      <h2 style="font-size:1.05rem;margin-top:22px;">Recent deliveries</h2>
      {recent.length === 0 ? <p class="muted">Nothing has washed ashore yet.</p> : (
        <div class="timeline">
          {recent.map((d) => (
            <div class="tl-item" key={d.id}>
              <span class="tl-dot"></span>
              <div class="tl-body">
                <span>{d.emoji} {d.itemName}</span>
                <div class="tl-meta">from {d.label}{d.day ? ` · day ${d.day}` : ''}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {latestScene && (
        <>
          <h2 style="font-size:1.05rem;margin-top:22px;">The latest visit</h2>
          <div class="scene-card">
            <div class="scene-kicker">Day {latestScene.day} · {latestScene.slot}</div>
            <h3 style="margin:4px 0;">{latestScene.title}</h3>
            <p class="scene-setup">{latestScene.setup}</p>
            {latestScene.summary && <p class="muted" style="font-size:13px;">{latestScene.summary}</p>}
            <p><a href={`/scene/${latestScene.id}`}>Read the full scene →</a></p>
          </div>
        </>
      )}

      {donors.length > 0 && (
        <>
          <h2 style="font-size:1.05rem;margin-top:22px;">Minds lent</h2>
          <p class="muted" style="font-size:13px;">Some patrons don't send gifts — they lend a stronger AI model, at their own cost, so Kevin, Jenny or the narrator think a little sharper.</p>
          <div class="timeline">
            {donors.map((d, i) => (
              <div class="tl-item" key={i}>
                <span class="tl-dot"></span>
                <div class="tl-body">
                  <span>{d.label}</span>
                  <div class="tl-meta">{d.model} · lent to {d.role} · {d.calls} turn{d.calls === 1 ? '' : 's'} answered</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 style="font-size:1.05rem;margin-top:22px;">How it works, and how it's kept safe</h2>
      <ul>
        <li>A public name is opt-in — set it in <a href="/account">your account</a>, or stay "an unseen friend" by default.</li>
        <li>Every gift is a bounded, code-applied nudge to the world — never a scripted line, never a guaranteed story beat.</li>
        <li>Kevin and Jenny never see a credit amount, a user id, or who is watching — only a crate and a name on its lid.</li>
        <li>Gifts are a donation to the experiment: not refundable once a crate is at sea, and never a countdown or a loot box.</li>
      </ul>
      <p><a href="/shop">Send a crate →</a></p>
    </BaseLayout>
  );
}
