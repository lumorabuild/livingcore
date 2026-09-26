/** @jsxImportSource hono/jsx */
// /account — LB sign-in, credit balance, patron name, gift history and
// lend-a-mind. Paper-sheet page (BaseLayout chrome="sheet"). Every field on
// this page is per-viewer, so the ROUTE (src/routes/account.tsx) always
// serves it Cache-Control: no-store — nothing here is ever meant to be
// cached at the edge.
//
// Signed-out: a short, honest reason to sign in (send a gift, lend a mind) —
// never a marketing wall. Signed-in: balance + a link out to the shared
// account center (RULE 4 — never an in-app "buy credits" UI), the patron
// name/visibility/daily-cap form (a plain <form method="post">, works with
// JS entirely off), gift history and lend-a-mind sections owned by A2/A3.
//
// ⚠️ public/app.css is owned by A2 this round, so this page deliberately
// reuses only classes that already exist (.wrap, .prose, .muted) plus a
// little inline layout — no new stylesheet rules invented here.

import { BaseLayout } from '../BaseLayout';
import type { Tint } from '../chrome';
import type { Viewer } from '../../lb/auth';
import type { PatronRow } from '../../lb/patrons';
import { patronLabel } from '../../lb/patrons';
import { GiftHistorySection } from '../account/gifts';
import { DonationsSection } from '../account/donations';
import type { GiftHistoryEntry } from '../../world/gifts';

export interface AccountNotice {
  kind: 'saved' | 'error';
  message: string;
}

export interface AccountPageProps {
  viewer: Viewer;
  tint?: Tint;
  /** Signed-out only: where "Sign in" should send them. */
  loginHref?: string;
  /** Signed-in only, from here down. */
  balance?: number | null;
  patron?: PatronRow;
  buyUrl?: string;
  encryptionEnabled?: boolean;
  notice?: AccountNotice | null;
  /** This page is served no-store (per-viewer), so SSR-ing the viewer's own
   *  gift history here is safe — see src/routes/account.tsx's GET /account. */
  gifts?: GiftHistoryEntry[];
}

function fmtCredits(n: number): string {
  try {
    return n.toLocaleString('en-US');
  } catch {
    return String(n);
  }
}

export function AccountPage({ viewer, tint, loginHref, balance, patron, buyUrl, encryptionEnabled, notice, gifts }: AccountPageProps) {
  const noticeColor = notice?.kind === 'error' ? '#b34242' : 'var(--muted, #666)';
  const noticeLine = notice && (
    <p style={`border-left:3px solid ${noticeColor};padding-left:.75em;`}>{notice.message}</p>
  );

  if (viewer.kind !== 'member') {
    return (
      <BaseLayout
        title="Your account — Living Core"
        description="Sign in with your Lumora Build account to send Kevin and Jenny a crate, or lend them a stronger mind."
        tint={tint}
        noindex
      >
        <div class="wrap">
          <h1>Your account</h1>
          {noticeLine}
          <article class="prose">
            <p>
              Sign in with your Lumora Build account to send Kevin and Jenny a crate from{' '}
              <a href="/shop">the shop</a>, or to <strong>lend a mind</strong> — lend a public AI model and your own
              key so one of them can think a little sharper for a while, on your own terms. Nothing about the
              island changes just by looking; signing in only unlocks those two things.
            </p>
            {viewer.kind === 'unknown' && (
              <p style="border-left:3px solid var(--muted, #999);padding-left:.75em;">
                Sign-in is briefly unavailable right now — try again in a moment.
              </p>
            )}
            <p>
              <a href={loginHref || '/auth/login'}>Sign in with Lumora Build →</a>
            </p>
          </article>
        </div>
      </BaseLayout>
    );
  }

  const label = patronLabel(patron || null);

  return (
    <BaseLayout
      title="Your account — Living Core"
      description="Your Lumora Build credit balance, patron name, daily spend cap, gift history and lend-a-mind settings."
      tint={tint}
      noindex
    >
      <div class="wrap">
        <h1>Your account</h1>
        <p class="muted">
          Signed in as {viewer.displayName || viewer.email}. <a href="/auth/logout">Sign out</a>
        </p>

        {noticeLine}

        <article class="prose">
          <h2>Credits</h2>
          {balance === null || balance === undefined ? (
            <p class="muted">Your balance is unavailable right now — try again shortly.</p>
          ) : (
            <p>
              Balance: <strong>{fmtCredits(balance)}</strong> credits.
            </p>
          )}
          <p>
            <a href={buyUrl || '/auth/login'}>Buy more credits →</a>{' '}
            <span class="muted">(handled entirely by the Lumora Build account center — never here)</span>
          </p>
        </article>

        <article class="prose">
          <h2>Your patron name</h2>
          <p class="muted">
            Optional, and hidden by default. Shown on crates ("from {label}") and, if you become one of the
            biggest patrons, at <a href="/shrine">the shrine</a>. Kevin and Jenny will never learn who "the
            Unseen" really are — only whatever name reaches them, or nothing at all.
          </p>
          <form method="post" action="/api/account/patron" id="patron-form">
            <div style="margin-bottom:.75em;">
              <label>
                Public name{' '}
                <input
                  type="text"
                  name="public_name"
                  id="patron-name-input"
                  maxlength={24}
                  placeholder="an unseen friend"
                  value={patron?.public_name || ''}
                  style="width:100%;max-width:22em;"
                />
              </label>
            </div>
            <div style="margin-bottom:.75em;">
              <label>
                <input type="checkbox" name="show_name" id="patron-show-input" value="1" checked={!!patron?.show_name} />
                {' '}Show this name (otherwise: "an unseen friend")
              </label>
            </div>
            <p class="muted" id="patron-preview">
              Preview: crates will read "from {label}".
            </p>
            <div style="margin-bottom:.75em;">
              <label>
                Daily spend cap (credits){' '}
                <input
                  type="number"
                  name="daily_cap"
                  min={100}
                  max={10000}
                  step={50}
                  value={patron?.daily_cap ?? 1000}
                  style="width:8em;"
                />
              </label>
            </div>
            <button type="submit">Save</button>
          </form>
        </article>

        <GiftHistorySection userId={viewer.userId} gifts={gifts} />

        <article class="prose">
          <h2>Lend a mind</h2>
          {encryptionEnabled ? (
            <p class="muted">
              Donate an AI model and your own API key so Kevin, Jenny or the narrator can think with a stronger
              model for a while. You choose the model and the daily limits; your own provider bills you for it
              — never Kevin, and never through this site.
            </p>
          ) : (
            <p style="border-left:3px solid var(--muted, #999);padding-left:.75em;">
              Lending a mind is temporarily disabled on this server (no encryption key configured for donated
              keys). Everything else on this page still works.
            </p>
          )}
          <DonationsSection userId={viewer.userId} enabled={!!encryptionEnabled} />
        </article>
      </div>

      <script src="/account-profile.js" defer></script>
      <script src="/account.js" defer></script>
    </BaseLayout>
  );
}
