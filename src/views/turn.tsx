/** @jsxImportSource hono/jsx */
// ─────────────────────────────────────────────────────────────────────────────
// SHARED TURN RENDERING — one place for "how a single dialogue turn looks",
// used by the live scene on the home page, /day/:n and /scene/:id so the
// three never drift apart.
//
// A turn's DO is often written first-person imperative ("Stand up, walk to
// the porch…") because that is how the model was asked to write it — this
// never rewrites those words, only styles them as a stage direction. When
// SAY is empty (the agent acted without speaking), the DO is shown on its
// own, prefixed with who is doing it — "Kevin — laces his boots…" — so a
// silent turn still reads as somebody's turn, not a stray line of italics.
// ─────────────────────────────────────────────────────────────────────────────

import { BIOGRAPHIES } from '../world/bio';
import type { AgentId } from '../world/types';

export interface TurnLike {
  say: string;
  action: string;
  retry_reason?: string | null;
}

/** Drops a leading capital + trailing period so "Stand up." reads naturally
 *  after an em dash: "Kevin — stand up, walk to the porch…" */
function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

/** True for a placeholder that means "nothing", however it's dressed —
 *  "nothing", "nothing.", "(nothing)", "[nothing]" — case-insensitive, with
 *  or without the surrounding punctuation the model sometimes copies
 *  straight out of the prompt's own format example. */
function isPlaceholderNothing(s: string): boolean {
  const norm = s.trim().toLowerCase().replace(/^[([]+|[)\].]+$/g, '').trim();
  return norm === '' || norm === 'nothing' || norm === 'silence' || norm === 'n/a';
}

export function isRealAction(action: string): boolean {
  return !!action && !isPlaceholderNothing(action);
}

/** True when SAY is real spoken dialogue, not an empty string or a stray
 *  "(nothing)" the model wrote literally instead of leaving SAY blank —
 *  measured live: this is why "an empty SAY renders as (nothing)" happened
 *  even though the empty-string case was already handled. */
export function isRealSay(say: string): boolean {
  return !!say && !isPlaceholderNothing(say);
}

/** Splits a scene's turns into two per-agent tracks for an apart scene's
 *  side-by-side rendering (part 2 spec §A/§B) — used by both HomePage's live
 *  panel and /scene/:id so the two never lay an apart scene out differently.
 *  Order within each track is preserved (both callers already fetch turns
 *  ascending by id). */
export function splitApartTurns<T extends { speaker: AgentId }>(turns: T[]): Record<AgentId, T[]> {
  const kevin: T[] = [], jenny: T[] = [];
  for (const t of turns) (t.speaker === 'kevin' ? kevin : jenny).push(t);
  return { kevin, jenny };
}

export function TurnBody({ t }: { t: TurnLike & { speaker: AgentId } }) {
  const hasSay = isRealSay(t.say);
  const hasAction = isRealAction(t.action);
  return (
    <>
      {hasSay && <p class="turn-say">{t.say}</p>}
      {hasAction && (
        <p class="turn-do">
          {!hasSay && <span class="turn-do-name">{BIOGRAPHIES[t.speaker].name} — </span>}
          {hasSay ? t.action : lowerFirst(t.action.trim())}
        </p>
      )}
      {!hasSay && !hasAction && <p class="turn-do turn-do-quiet">{BIOGRAPHIES[t.speaker].name} is quiet for a moment.</p>}
      {t.retry_reason && <p class="turn-retry">flagged: {t.retry_reason}</p>}
    </>
  );
}
