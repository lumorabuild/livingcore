// ─────────────────────────────────────────────────────────────────────────────
// MODEL CHAINS FOR THE ISLAND ERA.
//
// Four chains, drawn from the registry in src/core/nvidia.ts (probed 2026-09-25,
// see spec §1). The two agents deliberately START IN DIFFERENT MODEL FAMILIES —
// that is what stops one outage turning them into the same voice. That
// monoculture is exactly what happened in the talking era from 2026-07-30, when
// Kevin silently fell back to Jenny's llama-3.1-8b and the collapse accelerated
// (see src/world/eras.ts and the baseline table there).
//
// kevin  and jenny start on nvidia/google respectively and never share a
// PRIMARY; their shared last-resort link (laguna-xs) is deliberately the one
// model neither of them leads on.
// ─────────────────────────────────────────────────────────────────────────────

import type { AgentId } from './types';
import { NVIDIA_MODELS, NvidiaModelInfo } from '../core/nvidia';
import { BIOGRAPHIES } from './bio';

function chain(...keys: string[]): NvidiaModelInfo[] {
  return keys.map((k) => {
    const m = NVIDIA_MODELS[k];
    if (!m) throw new Error(`models.ts: unknown NVIDIA_MODELS key "${k}"`);
    return m;
  });
}

/** Kevin speaks. Nvidia family primary/secondary, then the shared cross-over link. */
export const KEVIN_CHAIN: NvidiaModelInfo[] = chain(
  'nemotron-3-ultra', 'nemotron-3-super', 'gpt-oss-20b', 'laguna-xs'
);

/** Jenny speaks. Google family primary/secondary, then the shared cross-over link. */
export const JENNY_CHAIN: NvidiaModelInfo[] = chain(
  'gemma-4-31b', 'diffusiongemma-26b', 'laguna-xs', 'mistral-nemotron'
);

/**
 * The narrator's transition/morning-setup calls: JSON-shaped output is what
 * matters, so diffusiongemma (cleanest, fastest JSON) leads and the two slow-
 * on-JSON dialogue models (gpt-oss aside) sit toward the back.
 */
// Order re-measured 2026-09-25 against a REAL transition prompt (3 calls each):
// diffusiongemma 3/3 valid JSON in 3–7 s; nemotron-3-ultra 3/3 in 15–28 s;
// gemma-4-31b and gpt-oss-20b 0/3 (60 s timeouts); nemotron-3-super 503 or
// timeout; laguna 503. The reliable pair leads so a flaky middle of the chain
// can't eat the tick's deadline before a working model is ever asked.
export const NARRATOR_CHAIN: NvidiaModelInfo[] = chain(
  'diffusiongemma-26b', 'nemotron-3-ultra', 'gemma-4-31b', 'nemotron-3-super', 'gpt-oss-20b'
);

/**
 * The end-of-day chapter: not time-critical (one call, once a day), so quality
 * leads even though nemotron-3-ultra is the slowest JSON responder in the set.
 */
export const CHAPTER_CHAIN: NvidiaModelInfo[] = chain(
  'nemotron-3-ultra', 'gemma-4-31b', 'nemotron-3-super', 'diffusiongemma-26b'
);

/** Which chain an agent speaks/plans/reflects on. */
export function chainFor(agent: AgentId): NvidiaModelInfo[] {
  return agent === 'kevin' ? KEVIN_CHAIN : JENNY_CHAIN;
}

/**
 * One place meta/UI can read "who is who" without importing bio.ts + this file
 * separately. Deliberately NOT called AGENTS (that name belonged to the old
 * talking-era engine in src/core/ai_dialogue.ts, now deleted — a stray old
 * import resolving to this instead would be a confusing near-miss, not a
 * compile error, so the name is different on purpose).
 */
export interface AgentMeta {
  name: string;
  color: string;
  emoji: string;
  chain: NvidiaModelInfo[];
}

export const ISLAND_AGENTS: Record<AgentId, AgentMeta> = {
  kevin: { name: BIOGRAPHIES.kevin.name, color: BIOGRAPHIES.kevin.color, emoji: BIOGRAPHIES.kevin.emoji, chain: KEVIN_CHAIN },
  jenny: { name: BIOGRAPHIES.jenny.name, color: BIOGRAPHIES.jenny.color, emoji: BIOGRAPHIES.jenny.emoji, chain: JENNY_CHAIN },
};
