// ─────────────────────────────────────────────────────────────────────────────
// Small, shared helper for "the same event twice in a row reads as one
// line with a ×N badge" — used by HomePage's "Day N so far" and DayPage's
// "What changed", so the two never grow two different rules for it.
// ─────────────────────────────────────────────────────────────────────────────

/** Collapses ADJACENT items that share `keyFn(item)` into one, keeping the
 *  first and counting the rest. Non-adjacent repeats are left alone on
 *  purpose — the same milestone reported hours apart is still two real
 *  moments in the day, not a glitch. */
export function collapseConsecutive<T>(items: T[], keyFn: (item: T) => string): (T & { repeatCount: number })[] {
  const out: (T & { repeatCount: number })[] = [];
  let lastKey: string | null = null;
  for (const item of items) {
    const key = keyFn(item);
    const last = out[out.length - 1];
    if (last && lastKey === key) {
      last.repeatCount += 1;
      continue;
    }
    out.push({ ...item, repeatCount: 1 });
    lastKey = key;
  }
  return out;
}
