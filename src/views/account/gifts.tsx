/** @jsxImportSource hono/jsx */
// Gift history for the signed-in patron's /account page — patrons, spec §A2.
// A1's account.tsx fetches world/gifts.ts#giftHistory server-side (this page
// is NO_STORE, so per-viewer SSR is fine — src/cache.ts's rule) and passes the
// rows in; this component only ever renders what it's given.
import type { GiftHistoryEntry, GiftStatus } from '../../world/gifts';

const STATUS_LABEL: Record<GiftStatus, string> = {
  pending: 'confirming payment',
  queued: 'at sea',
  delivered: 'delivered',
  failed: 'not sent — not charged',
  unconfirmed: 'payment unclear — contact support',
  stale: 'refund on its way',
  refunded: 'refunded',
};

export function GiftHistorySection({ userId: _userId, gifts }: { userId: string; gifts?: unknown[] }) {
  const rows = (gifts || []) as GiftHistoryEntry[];
  return (
    <section id="gift-history">
      <h2 style="font-size:1.05rem;">Gifts you've sent</h2>
      {rows.length === 0 ? (
        <p class="muted">Nothing yet — <a href="/shop">send them a crate</a>.</p>
      ) : (
        <div class="timeline">
          {rows.map((g) => (
            <div class="tl-item" key={g.id}>
              <span class="tl-dot"></span>
              <div class="tl-body">
                <span>{g.emoji} {g.itemName}</span>
                <div class="tl-meta">
                  {g.credits.toLocaleString()} credits · {STATUS_LABEL[g.status] || g.status}
                  {g.deliveredDay ? ` · day ${g.deliveredDay}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {rows.some((g) => g.status === 'unconfirmed') && (
        <p style="font-size:13px;">
          A payment marked unclear may or may not have gone through.{' '}
          <a href="https://id.lumorabuild.com/account/support">Contact support</a> and we'll put it right.
        </p>
      )}
      <p class="muted" style="font-size:12px;">Gifts are a donation to the experiment — not refundable once a crate is at sea.</p>
    </section>
  );
}
