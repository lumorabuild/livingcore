/** @jsxImportSource hono/jsx */
// /account "Lend a mind" section (SPEC4 §A3, BYOK).
//
// AccountPage.tsx only ever passes {userId, enabled} — this stays a plain,
// no-JS-capable "donate a model" form (a real <form method=post>, works the
// same way the patron form above it does) plus one empty container that
// public/account.js fills from GET /api/account/donations. Same split
// GiftHistorySection uses: the page is served Cache-Control: no-store, but
// the per-donor LIST still isn't baked into the HTML the CDN could ever be
// tempted to cache — defense in depth, not just policy.
//
// The key field is type=password and there is no "show my key" anywhere —
// once submitted, the only thing the donor ever sees again is the masked
// preview account.js renders from the API's key_preview field.
import { PROVIDERS, CONSENT_VERSION, type Provider } from '../../world/donations';

export function DonationsSection(_props: { userId: string; donations?: unknown[]; enabled?: boolean }) {
  if (!_props.enabled) return <section id="lend-a-mind"></section>;

  const providerIds = Object.keys(PROVIDERS) as Provider[];
  const firstPlaceholder = PROVIDERS[providerIds[0]].modelPlaceholder;

  return (
    <section id="lend-a-mind">
      <div id="lend-a-mind-list" class="muted" data-loading="1">Loading your donated models…</div>

      <details style="margin-top:1em;">
        <summary>Donate a model</summary>
        <form id="donation-form" method="post" action="/api/account/donations" style="margin-top:.75em;">
          <div style="margin-bottom:.75em;">
            <label>
              Provider{' '}
              <select name="provider" id="donation-provider">
                {providerIds.map((p) => (
                  <option value={p} data-placeholder={PROVIDERS[p].modelPlaceholder}>{PROVIDERS[p].label}</option>
                ))}
              </select>
            </label>
          </div>
          <div style="margin-bottom:.75em;">
            <label>
              Model id{' '}
              <input
                type="text"
                name="model"
                id="donation-model"
                placeholder={firstPlaceholder}
                maxlength={120}
                style="width:100%;max-width:24em;"
                required
              />
            </label>
          </div>
          <div style="margin-bottom:.75em;">
            <label>
              Who should think with it?{' '}
              <select name="role">
                <option value="kevin">Kevin</option>
                <option value="jenny">Jenny</option>
                <option value="narrator">The narrator (what the world does in answer)</option>
              </select>
            </label>
          </div>
          <div style="margin-bottom:.75em;">
            <label>
              Your API key{' '}
              <input type="password" name="api_key" autocomplete="off" required style="width:100%;max-width:24em;" />
            </label>
          </div>
          <div style="margin-bottom:.75em;">
            <label>Calls / day{' '}
              <input type="number" name="calls_per_day" min={10} max={2000} step={10} value={200} style="width:7em;" />
            </label>{' '}
            <label>Tokens / day{' '}
              <input type="number" name="tokens_per_day" min={10000} max={3000000} step={10000} value={300000} style="width:9em;" />
            </label>
          </div>

          <div class="prose" style="border-left:3px solid var(--muted, #999);padding-left:.75em;margin-bottom:.75em;">
            <p><strong>Before you donate a model:</strong></p>
            <ul>
              <li>You're giving Living Core permission to use <strong>your own API key</strong>, at your own provider, to generate some of Kevin, Jenny's or the narrator's thoughts, words and actions on the island.</li>
              <li><strong>Your provider bills you</strong> for this usage, at their rates — never Living Core's, and this never costs Kevin anything.</li>
              <li><strong>You set the ceiling.</strong> A daily call limit and a daily token limit, enforced before every single call. Pause or revoke at any time — effective immediately.</li>
              <li><strong>Your key is encrypted and never shown again</strong> after you enter it — only a masked preview, like <code>••••ab12</code>.</li>
              <li><strong>Your identity is never attached to what gets said.</strong> Kevin and Jenny never learn who "the Unseen" are, and a public thanks (if you also chose a patron name above) shows only that name — never your email.</li>
              <li>This is a donation, not a purchase — it buys nothing, and Living Core has no billing surface of its own (all Lumora Build billing lives at the shared account center).</li>
              <li>You're responsible for the key being yours to give. A key that starts failing is paused automatically and visibly, and it never resumes without you.</li>
            </ul>
            <label>
              <input type="checkbox" name="consent" value="1" required />{' '}
              I've read this and I accept.
            </label>
            <input type="hidden" name="consent_version" value={CONSENT_VERSION} />
          </div>

          <button type="submit">Donate this model</button>
          <span class="muted" id="donation-form-msg" role="status" style="margin-left:.75em;"></span>
        </form>
      </details>
    </section>
  );
}
