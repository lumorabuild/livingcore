/** @jsxImportSource hono/jsx */
// ─────────────────────────────────────────────────────────────────────────────
// /shop — patrons, spec §A2. A paper-sheet page in the site's own style: the
// catalog, sectioned by category, each item a card with its price in LB
// credits and a plain-language "In their world: …" effect line.
//
// NO viewer-specific SSR CACHING (src/cache.ts's rule): this page is served
// `NO_STORE` (src/routes/shop.tsx), so it is safe to render the signed-in
// viewer's balance/sign-in state directly in the HTML — there is no edge copy
// that could leak one visitor's state to another.
//
// The confirmation step for a gift >= 500 credits is a real, no-JS-safe
// second page load: the "Review this gift" link is a plain GET to
// `/shop?confirm=<id>` (server-rendered here as an expanded review panel with
// its own POST form carrying `confirm=1`), never a client-only dialog someone
// without JS would silently skip past.
// ─────────────────────────────────────────────────────────────────────────────

import { BaseLayout } from '../BaseLayout';
import type { Tint } from '../chrome';
import type { Viewer } from '../../lb/auth';
import { loginUrl, buyCreditsUrl } from '../../lb/auth';
import type { PatronRow } from '../../lb/patrons';
import { CATALOG, CATEGORY_LABEL, CATEGORY_ORDER, itemsByCategory, type CatalogItem, type GiftCategory } from '../../world/catalog';

export interface ShopPageProps {
  viewer: Viewer;
  tint: Tint;
  balance: number | null;
  patron: PatronRow | null;
  confirmItemId: string | null;
  boughtItemId: string | null;
  errorReason: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  signed_out: 'Sign in to send a gift.',
  not_found: "That isn't something the shop sells any more.",
  needs_confirm: 'Review the gift below before sending it.',
  daily_cap: 'That would pass your daily gift cap — raise it in your account settings if you meant to.',
  cooldown: 'The world can only take so much of this at once — try again in a few island days.',
  insufficient: "You don't have enough credits for this gift.",
  unconfirmed: "We couldn't confirm whether this payment went through. If credits left your balance, contact support and we'll put it right.",
  refunded: "This gift couldn't be delivered, so its credits are going back to you.",
  not_sent: "This gift wasn't sent, and you weren't charged.",
  pending: 'This gift is still being confirmed. It will show in your gift history within a few minutes — no need to send it again.',
  error: 'Something went wrong. You were not charged.',
};

export function ShopPage({ data }: { data: ShopPageProps }) {
  const { viewer, tint, balance, patron, confirmItemId, boughtItemId, errorReason } = data;
  const signedIn = viewer.kind === 'member';
  const confirmItem = confirmItemId ? CATALOG.find((i) => i.id === confirmItemId) : null;
  const boughtItem = boughtItemId ? CATALOG.find((i) => i.id === boughtItemId) : null;

  return (
    <BaseLayout
      tint={tint}
      title="Send them a crate — Living Core"
      description="A gift, paid in Lumora Build credits, arrives on Sorrel Island as a sealed crate — food, treats, tools and rare big gifts for Kevin & Jenny."
      canonicalUrl="https://livingcore.cc/shop"
    >
      <p class="muted" style="margin:14px 0 0;"><a href="/">← Back to the island</a></p>
      <h1>Send them a crate</h1>
      <p class="muted">
        Every gift here is paid in Lumora Build credits and arrives IN-WORLD as a sealed crate, washed up on the beach —
        never a message, never a script. Kevin and Jenny don't know who sends them, only what a name burned into the
        lid says. <strong>This is a gift to the experiment: it washes up within an island day or two, and credits
        aren't refundable once a crate is at sea.</strong>
      </p>

      {!signedIn && (
        <div class="offline-note" style="margin:14px 0;">
          <a href={loginUrl('/shop')}>Sign in with your Lumora Build account</a> to send a gift. Browsing the shop needs no account.
        </div>
      )}
      {signedIn && balance !== null && (
        <p class="muted" style="font-size:13px;">
          Your balance: <strong>{balance.toLocaleString()} credits</strong>{' · '}
          <a href={buyCreditsUrl('/shop')}>manage credits</a>
          {patron && <> {' · '}<a href="/account">your gift settings</a> (daily cap: {patron.daily_cap} credits)</>}
        </p>
      )}

      {boughtItem && (
        <div class="bottle-feedback" style="margin:10px 0;">
          {boughtItem.emoji} <strong>{boughtItem.name}</strong> is at sea — it washes up on Sorrel Island within an island day or two.
        </div>
      )}
      {errorReason && !confirmItem && (
        <div class="bottle-feedback err" style="margin:10px 0;">{ERROR_MESSAGES[errorReason] || 'Something went wrong.'}</div>
      )}

      {confirmItem && (
        <ConfirmPanel item={confirmItem} signedIn={signedIn} balance={balance} />
      )}

      {CATEGORY_ORDER.map((cat) => (
        <CategorySection key={cat} category={cat} signedIn={signedIn} />
      ))}

      <p class="muted" style="font-size:12px;margin-top:18px;">
        No loot boxes, no random contents, no countdowns. The only randomness is <em>when</em> a queued crate washes
        ashore. See the <a href="/shrine">shrine</a> for who Kevin and Jenny have come to thank, and <a href="/account">your
        account</a> to lend a mind instead of (or as well as) a gift.
      </p>
    </BaseLayout>
  );
}

function ConfirmPanel({ item, signedIn, balance }: { item: CatalogItem; signedIn: boolean; balance: number | null }) {
  const short = balance !== null && balance < item.credits;
  return (
    <div class="project-row" id={`confirm-${item.id}`} style="border:1px solid var(--gold);background:var(--gold-bg);margin:14px 0;">
      <div class="project-top">
        <span class="project-name">{item.emoji} Review: {item.name}</span>
        <span class="kind-pill">{item.credits.toLocaleString()} credits</span>
      </div>
      <p style="margin:6px 0;">{item.blurb}</p>
      <p class="muted" style="margin:0 0 8px;">{item.effectLine}</p>
      <p class="muted" style="font-size:12px;">
        This is a gift to the experiment — Kevin &amp; Jenny will find it on the beach, and credits aren't refundable
        once it's sent.
      </p>
      {!signedIn ? (
        <p><a href={loginUrl('/shop')} class="btn">Sign in to send this gift</a></p>
      ) : short ? (
        <p><a href={buyCreditsUrl('/shop')} class="btn">You need more credits — manage credits</a></p>
      ) : (
        <form method="post" action="/api/shop/buy" class="bottle-row">
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="confirm" value="1" />
          <input type="hidden" name="intent" value={crypto.randomUUID()} />
          <button class="btn" type="submit">Yes — send it</button>
          <a href="/shop">Cancel</a>
        </form>
      )}
    </div>
  );
}

function CategorySection({ category, signedIn }: { category: GiftCategory; signedIn: boolean }) {
  const items = itemsByCategory(category);
  return (
    <section style="margin-top:22px;">
      <h2 style="font-size:1.05rem;">{CATEGORY_LABEL[category]}</h2>
      <div class="projects">
        {items.map((item) => <ItemCard key={item.id} item={item} signedIn={signedIn} />)}
      </div>
    </section>
  );
}

function ItemCard({ item, signedIn }: { item: CatalogItem; signedIn: boolean }) {
  const needsConfirm = item.credits >= 500;
  return (
    <div class="project-row" id={`item-${item.id}`}>
      <div class="project-top">
        <span class="project-name">{item.emoji} {item.name}</span>
        <span class="kind-pill">{item.credits.toLocaleString()} credits</span>
      </div>
      <p style="margin:4px 0;">{item.blurb}</p>
      <p class="muted" style="margin:0 0 8px;font-size:12.5px;">{item.effectLine}</p>
      {!signedIn ? (
        <a href={loginUrl('/shop')} class="btn">Sign in to send</a>
      ) : needsConfirm ? (
        <a href={`/shop?confirm=${item.id}#confirm-${item.id}`} class="btn">Review this gift →</a>
      ) : (
        <form method="post" action="/api/shop/buy">
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="intent" value={crypto.randomUUID()} />
          <button class="btn" type="submit">Send it</button>
        </form>
      )}
    </div>
  );
}
