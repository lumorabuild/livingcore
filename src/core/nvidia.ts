// NVIDIA API (build.nvidia.com) — OpenAI-compatible chat completions.
// One key, one endpoint (https://integrate.api.nvidia.com/v1); the model is just a
// string in the request body. The registry below holds every model validated with
// our key, so livingcore (and future projects) can pick any of them by short name.
//
// The key lives ONLY in the Worker secret NVIDIA_API_KEY (wrangler secret put) and
// .dev.vars locally — never in code or git.
//
// ─────────────────────────────────────────────────────────────────────────────
// FREE-TIER INVARIANT (Kevin's rule, 2026-07-17): livingcore must ONLY ever call
// NVIDIA's free developer tier — never a paid provider, never a paid endpoint.
// This is safe BY CONSTRUCTION and must stay that way:
//   • This module is the ONLY place that talks to any AI. The single fetch() below
//     hits NVIDIA_BASE_URL and nothing else. There is no OpenAI/Anthropic/Google/
//     Workers-AI code path anywhere in the repo — keep it that way.
//   • Every model on build.nvidia.com is free on the developer tier. There is NO
//     per-token or per-model billing on this endpoint and NO card on the account,
//     so no call here can ever incur a charge. Over-use returns HTTP 429 (handled
//     in nvidiaChat), never a bill.
//   • The real ceiling is RATE, not money: FREE_TIER_RPM below. Stay under it.
// Before adding a model to the registry: (1) probe it returns a real completion
// (status:'ok'), and (2) confirm it's reachable on THIS endpoint with our key —
// which, by the point above, guarantees it's free. Do NOT add a model that needs
// any other endpoint, key, or account tier.
// ─────────────────────────────────────────────────────────────────────────────

export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

// NVIDIA free developer tier: 40 requests/minute (upgradable to 200 on request).
// Documented here as the hard operating budget. livingcore's peak is well under it:
// the cron fires every 2 min and a worst-case tick (reflection for both agents +
// a fresh turn, incl. fallback/accept retries) is ~8-10 calls clustered in ~20s,
// i.e. ≈10 req in a rolling minute — 4x headroom. Anything that raises call volume
// (faster cron, more agents, un-throttled visitor input) must be checked against
// this number first.
export const FREE_TIER_RPM = 40;

/**
 * When the registry below was last checked against the live API with a real
 * persona-shaped prompt (scripts in the repo's history; re-probe before trusting
 * `status` after a long gap).
 *
 * ⚠️ HARD-WON LESSON (2026-07-17): NVIDIA keeps dead models in `GET /v1/models`
 * and its NIM router simply *hangs* on them instead of returning 404. A listed
 * model is NOT a working model — the only proof is a real completion. Both of the
 * models this site ran on (llama-4-maverick, ministral-14b) vanished this way and
 * Kevin & Jenny went silent for two days. Hence `status` + the fallback chain.
 *
 * 2026-09-25 (island era): re-probed the whole catalogue with this key — most of
 * it now 404s. mistral-small-4 and llama-3.1-8b (the talking-era pair) are BOTH
 * gone; see src/world/eras.ts for what that pairing did to the talking era once
 * Kevin silently fell back to Jenny's model. New registry entries below are the
 * island era's four chains (src/world/models.ts).
 */
export const REGISTRY_VERIFIED_ON = '2026-09-25';

export type NvidiaModelStatus =
  | 'ok'           // returned a real completion on the date above
  | 'unavailable'; // listed by the API but hangs / 4xx — do not use

export interface NvidiaModelInfo {
  id: string;            // value for the API's "model" field
  label: string;
  family: string;
  // Defaults that behave well for THIS model (kimi melts down above ~0.6, etc.)
  goodTemp: number;
  maxTokens: number;
  status: NvidiaModelStatus;
  notes: string;
}

// The full catalogue we've probed with our key, kept as a reusable registry for
// other projects. `status` is what the live probe said on REGISTRY_VERIFIED_ON —
// dead entries stay listed on purpose so nobody re-picks a known-bad model.
// livingcore runs mistral-small-4 (Kevin) and llama-3.1-8b (Jenny).
export const NVIDIA_MODELS: Record<string, NvidiaModelInfo> = {
  'mistral-small-4': {
    id: 'mistralai/mistral-small-4-119b-2603',
    label: 'Mistral Small 4 (119B)',
    family: 'mistral',
    goodTemp: 0.85,
    maxTokens: 1024,
    status: 'unavailable',
    notes: 'Was Kevin\'s talking-era model (2026-07-17 → 2026-08-26). 404s on this key as ' +
      'of 2026-09-25. Do not use.',
  },
  'llama-3.1-8b': {
    id: 'meta/llama-3.1-8b-instruct',
    label: 'Llama 3.1 8B',
    family: 'meta',
    goodTemp: 0.8,
    maxTokens: 1024,
    status: 'unavailable',
    notes: 'Was Jenny\'s talking-era model. From 2026-07-30 Kevin silently fell back to THIS ' +
      'model too (both agents on one model), which is what the talking-era collapse charts on ' +
      '/lab show — see src/world/eras.ts. 404s on this key as of 2026-09-25. Do not use.',
  },
  // ── Island era (2026-09-25) — see src/world/models.ts for the four chains ──
  'nemotron-3-ultra': {
    id: 'nvidia/nemotron-3-ultra-550b-a55b',
    label: 'Nemotron 3 Ultra (550B-A55B)',
    family: 'nvidia',
    goodTemp: 0.85,
    maxTokens: 1024,
    status: 'ok',
    notes: 'Largest of the working set, 3-5s, the best voice of the four probed for dialogue — ' +
      'Kevin\'s primary. Slow on JSON (~40s), so it leads the chapter chain but sits at the ' +
      'END of the narrator chain. Needs chat_template_kwargs:{enable_thinking:false} or it ' +
      'emits its reasoning as content (verified 2026-09-25).',
  },
  'nemotron-3-super': {
    id: 'nvidia/nemotron-3-super-120b-a12b',
    label: 'Nemotron 3 Super (120B-A12B)',
    family: 'nvidia',
    goodTemp: 0.8,
    maxTokens: 1024,
    status: 'ok',
    notes: 'Fast (2-3s), good voice, Kevin\'s 2nd link. Sometimes 503 overloaded — the chain ' +
      'exists for exactly this. Same enable_thinking:false requirement as nemotron-3-ultra ' +
      '(verified 2026-09-25).',
  },
  'gemma-4-31b': {
    id: 'google/gemma-4-31b-it',
    label: 'Gemma 4 (31B) IT',
    family: 'google',
    goodTemp: 0.85,
    maxTokens: 1024,
    status: 'ok',
    notes: 'Natural dialogue voice (3-20s) — Jenny\'s primary. On JSON tasks wraps the answer ' +
      'in ```json fences (11s) — nvidiaChat/chain callers that need JSON must strip fences ' +
      'themselves (verified 2026-09-25).',
  },
  'diffusiongemma-26b': {
    id: 'google/diffusiongemma-26b-a4b-it',
    label: 'DiffusionGemma (26B-A4B) IT',
    family: 'google',
    goodTemp: 0.8,
    maxTokens: 1024,
    status: 'ok',
    notes: 'Fastest of the four (1-2s dialogue, 3s clean JSON with no fence) — Jenny\'s 2nd ' +
      'link and the narrator chain\'s primary (JSON is its strength). Verified 2026-09-25.',
  },
  'laguna-xs': {
    id: 'poolside/laguna-xs-2.1',
    label: 'Laguna XS 2.1',
    family: 'poolside',
    goodTemp: 0.8,
    maxTokens: 1024,
    status: 'ok',
    notes: 'Natural voice, 2-4s dialogue, 37s JSON (slow — keep it out of the front of the ' +
      'narrator chain). Shared last-resort link on both Kevin\'s and Jenny\'s chains, ' +
      'deliberately: it is the one model neither agent leads on, so a Kevin outage and a ' +
      'Jenny outage never collapse them onto each other\'s model (verified 2026-09-25).',
  },
  'gpt-oss-20b': {
    id: 'openai/gpt-oss-20b',
    label: 'GPT-OSS 20B',
    family: 'openai',
    goodTemp: 0.8,
    maxTokens: 1024,
    status: 'ok',
    notes: 'Plain voice (3-4s), clean JSON (10s). Needs reasoning_effort:"low" — without it, ' +
      'higher effort settings burn tokens on hidden reasoning before answering. Verified ' +
      '2026-09-25.',
  },
  'llama-3.2-11b-vision': {
    id: 'meta/llama-3.2-11b-vision-instruct',
    label: 'Llama 3.2 11B Vision',
    family: 'meta',
    goodTemp: 0.8,
    maxTokens: 1024,
    status: 'ok',
    notes: 'Fast and supports vision (image_url content parts; nvidiaChat currently sends ' +
      'text-only messages). Runs terse on long persona prompts — fine for tasks, weak for chat',
  },
  'nemotron-mini-4b': {
    id: 'nvidia/nemotron-mini-4b-instruct',
    label: 'Nemotron Mini 4B',
    family: 'nvidia',
    goodTemp: 0.7,
    maxTokens: 1024,
    status: 'ok',
    notes: 'Smallest and fastest (~0.4s) — simple tasks only. CAUTION: on persona prompts it ' +
      'parrots the instructions back verbatim (echoed "[remember: the thing to save]") — ' +
      'never use it as a dialogue model (verified 2026-07-17)',
  },
  'llama-4-maverick': {
    id: 'meta/llama-4-maverick-17b-128e-instruct',
    label: 'Llama 4 Maverick 17B',
    family: 'meta',
    goodTemp: 0.85,
    maxTokens: 1024,
    status: 'unavailable',
    notes: 'WAS Kevin until 2026-07-15. Still listed by /v1/models but every request hangs ' +
      'until the client gives up (3/3 probes timed out at 40s+, 2026-07-17). Do not use.',
  },
  'ministral-14b': {
    id: 'mistralai/ministral-14b-instruct-2512',
    label: 'Ministral 14B',
    family: 'mistral',
    goodTemp: 0.8,
    maxTokens: 1024,
    status: 'unavailable',
    notes: 'WAS Jenny until 2026-07-15. Still listed by /v1/models but every request hangs ' +
      '(3/3 probes timed out at 40s+, 2026-07-17). Do not use.',
  },
  'mistral-nemotron': {
    id: 'mistralai/mistral-nemotron',
    label: 'Mistral Nemotron',
    family: 'mistral',
    goodTemp: 0.6,
    maxTokens: 1024,
    status: 'ok',
    notes: 'Back up (2026-09-25) after flapping in July — but still flaky (8-27s, sometimes ' +
      '500) and its JSON is unreliable, so it only sits at the END of Jenny\'s chain, never ' +
      'the narrator chain. NEVER send top_p to this family — it 400s ("Function id …") on it.',
  },
  'kimi-k3': {
    id: 'moonshotai/kimi-k3',
    label: 'Kimi K3',
    family: 'moonshot',
    goodTemp: 0.6,
    maxTokens: 1024,
    status: 'unavailable',
    notes: 'Times out on every probe (2026-09-25). Same family as kimi-k2.6, same result. ' +
      'Also rejects top_p (see mistral-nemotron) — never send it to any moonshotai/* id.',
  },
  'glm-5.3': {
    id: 'zai-org/glm-5.3',
    label: 'GLM 5.3',
    family: 'zai',
    goodTemp: 0.7,
    maxTokens: 1024,
    status: 'unavailable',
    notes: 'Thinking cannot be disabled on this deployment (no working chat_template_kwargs), ' +
      'and it takes 40s+ once you let it think. Do not use for a time-boxed cron tick.',
  },
  'deepseek-v4.1-flash': {
    id: 'deepseek-ai/deepseek-v4.1-flash',
    label: 'DeepSeek V4.1 Flash',
    family: 'deepseek',
    goodTemp: 0.7,
    maxTokens: 1024,
    status: 'unavailable',
    notes: '~80s per call on this key (2026-09-25) — too slow for the 85s per-tick wall clock ' +
      'budget once anything else has run. Do not use.',
  },
  'muse-glimmer': {
    id: 'inception/muse-glimmer',
    label: 'Muse Glimmer',
    family: 'inception',
    goodTemp: 0.7,
    maxTokens: 1024,
    status: 'unavailable',
    notes: '500s on every probe (2026-09-25). Do not use.',
  },
  'nemotron-3.5-lightning': {
    id: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    label: 'Nemotron 3.5 Lightning (30B-A3B)',
    family: 'nvidia',
    goodTemp: 0.8,
    maxTokens: 1024,
    status: 'unavailable',
    notes: 'Answers fast but degenerate on persona prompts (2026-09-25 — same family as the ' +
      'model warmaplive/techmaplive dropped from their ingest chain for the same reason, see ' +
      'the root CLAUDE.md warmaplive row). Do not use for dialogue or JSON.',
  },
  'nemotron-nano-8b': {
    id: 'nvidia/llama-3.1-nemotron-nano-8b-v1',
    label: 'Nemotron Nano 8B',
    family: 'nvidia',
    goodTemp: 0.7,
    maxTokens: 1024,
    status: 'unavailable',
    notes: "NVIDIA's in-house nano. Worked 2026-06-12; now hangs like the others (2026-07-17)",
  },
  'kimi-k2.6': {
    id: 'moonshotai/kimi-k2.6',
    label: 'Kimi K2.6',
    family: 'moonshot',
    goodTemp: 0.6,
    maxTokens: 1500,
    status: 'unavailable',
    notes: 'Reasoning MoE. Collapsed into repetition garbage on persona prompts (2026-06-12) ' +
      'and now 404s outright (2026-07-17)',
  },
};

/** Models that actually answered on REGISTRY_VERIFIED_ON. */
export function healthyModels(): NvidiaModelInfo[] {
  return Object.values(NVIDIA_MODELS).filter(m => m.status === 'ok');
}

export interface NvidiaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface NvidiaChatRequest {
  model: string;
  messages: NvidiaChatMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}

export interface NvidiaChatResult {
  ok: boolean;
  text: string;
  finishReason: string;
  totalTokens: number;   // real usage when reported, conservative estimate otherwise
  error?: string;
  /** HTTP status of the LAST attempt; 0 for a network error / timeout that never got one. */
  status: number;
}

const CHARS_PER_TOKEN = 3.5; // overcount slightly when no usage block is returned

function estimateTokens(messages: NvidiaChatMessage[], output: string): number {
  const inputChars = messages.reduce((n, m) => n + m.content.length, 0);
  return Math.ceil((inputChars + output.length) / CHARS_PER_TOKEN);
}

/**
 * Per-model extra body fields a working reply needs (island era, §1):
 *   • the nemotron-3 family emits its <think>…</think> reasoning as ordinary
 *     content unless thinking is explicitly turned off;
 *   • gpt-oss burns tokens on hidden reasoning above the lowest effort setting.
 * Never add `top_p` here for any model — the moonshotai/mistral-nemotron
 * families 400 on it ("Function id …"), and nothing in this app needs it.
 */
export function requestExtras(id: string): Record<string, unknown> {
  if (id.startsWith('nvidia/nemotron-3')) return { chat_template_kwargs: { enable_thinking: false } };
  if (id.includes('gpt-oss')) return { reasoning_effort: 'low' };
  return {};
}

/**
 * A model that cannot fully turn off its reasoning (or one probed before we
 * knew to ask) sometimes prefixes the real answer with a `<think>…</think>`
 * block. Strip it so callers never have to special-case it themselves.
 */
export function stripThink(text: string): string {
  return text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '').trim();
}

/**
 * Single chat completion against the NVIDIA API.
 * Retries once on transport errors / 429 / 5xx; never throws — inspect `.ok`.
 */
export async function nvidiaChat(
  apiKey: string,
  req: NvidiaChatRequest,
  opts: { timeoutMs?: number; retries?: number } = {}
): Promise<NvidiaChatResult> {
  // 20s is ~10x the measured p95 for the models we run (~2s for a full 700-token
  // reply on a long persona prompt), and deliberately far below the old 60s: a
  // dead NIM hangs forever, so the timeout IS the failure detector. Keeping it
  // tight is what lets the fallback chain still finish inside one 2-min cron tick.
  const timeoutMs = opts.timeoutMs ?? 20000;
  const retries = opts.retries ?? 1;

  const body = JSON.stringify({
    model: req.model,
    messages: req.messages,
    max_tokens: req.maxTokens ?? 1024,
    temperature: req.temperature ?? 0.7,
    ...(req.topP ? { top_p: req.topP } : {}),
    ...requestExtras(req.model),
  });

  let lastError = '';
  let lastStatus = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
    try {
      const res = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      lastStatus = res.status;

      if (!res.ok) {
        lastError = `HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`;
        // 4xx (except 429) won't get better on retry
        if (res.status !== 429 && res.status < 500) break;
        continue;
      }

      const data: any = await res.json();
      const choice = data?.choices?.[0];
      // Reasoning models (kimi) put thinking in a separate field; we only want content.
      // A model that could not fully disable thinking (or one probed before requestExtras
      // knew to ask) may still prefix a <think>…</think> block onto real content — strip it.
      const raw: string = typeof choice?.message?.content === 'string' ? choice.message.content : '';
      const text: string = stripThink(raw);
      const finishReason: string = choice?.finish_reason || '';
      const totalTokens: number =
        typeof data?.usage?.total_tokens === 'number'
          ? data.usage.total_tokens
          : estimateTokens(req.messages, text);

      if (!text) {
        lastError = `empty content (finish: ${finishReason || 'unknown'})`;
        continue;
      }

      return { ok: true, text, finishReason, totalTokens, status: lastStatus };
    } catch (err) {
      lastError = String(err).slice(0, 200);
      lastStatus = 0; // network error / timeout — never reached the server
    }
  }

  return { ok: false, text: '', finishReason: 'error', totalTokens: 0, error: lastError, status: lastStatus };
}

export interface NvidiaChatChainResult extends NvidiaChatResult {
  /** The model that actually produced `text` — may not be the first one asked. */
  model: NvidiaModelInfo;
  /** True when the primary was skipped over and a fallback answered instead. */
  usedFallback: boolean;
  /** Model ids that answered 404/410 THIS call — the caller should markGone() them. */
  gone: string[];
  /** One entry per model actually tried, in order, for provenance/debugging. */
  attempts: { id: string; status: number; ms: number }[];
}

/**
 * Try each model in `chain` (primary first) and return the first real completion.
 *
 * This exists because NVIDIA silently retires free NIM deployments: on 2026-07-15
 * both of this site's models died at once and, with no fallback, Kevin & Jenny had
 * nothing to speak through for two days. One dead model must never again equal a
 * dead site.
 *
 * Each link gets ONE shot (retries: 0) — the chain is the retry, and a hung NIM
 * won't un-hang on a second try. Cost when the primary is dead: one timeout, then
 * the fallback answers normally.
 *
 * Honesty note: the winning model is returned so callers can record *which* model
 * really spoke. The public archive/dataset must never attribute a fallback's words
 * to the primary.
 */
/**
 * A wall-clock deadline (epoch ms) every chain call must finish by, or null.
 *
 * Module state on purpose, and safe only because of who calls models: the
 * cron tick is the ONLY caller (the inbox stopped calling models in the island
 * era), and ticks are serialised by the D1 tick lock, so two ticks never share
 * an isolate's deadline at once. runTick sets it after taking the lock and
 * clears it in `finally`. If a second caller ever appears, pass the deadline
 * explicitly instead of widening this.
 */
let callDeadline: number | null = null;
const MIN_USEFUL_CALL_MS = 4000;

export function setCallDeadline(epochMs: number | null): void {
  callDeadline = epochMs;
}

export async function nvidiaChatChain(
  apiKey: string,
  chain: NvidiaModelInfo[],
  req: Omit<NvidiaChatRequest, 'model'> & {
    /** Nudge each model off its OWN goodTemp (e.g. -0.2 to retry cooler). Ignored
     *  when `temperature` is set. Use this rather than computing a temperature from
     *  one model's goodTemp — a fallback should run at the temp IT likes. */
    tempOffset?: number;
  },
  opts: {
    timeoutMs?: number;
    /**
     * Usable-output gate for structured tasks. A model can return HTTP 200 with
     * content that's useless for the caller — e.g. reflection needs JSON, and
     * llama-3.1-8b (Jenny) often answers a long transcript with prose instead.
     * Transport success alone then "succeeds" with garbage and the chain never
     * falls through. When `accept` is given, a 200 whose text fails it is treated
     * like a soft failure: try the next model. This is why Jenny can still reflect —
     * her own model leads, but a request that needs JSON falls through to one that
     * emits it. Without `accept`, any 200 wins (the dialogue path, where all prose
     * is valid).
     */
    accept?: (text: string) => boolean;
    /**
     * Model ids to skip this call — src/world/store.ts's dead-model memory
     * (getGoneModels). If EVERY model in the chain is in `skip`, the skip set
     * is ignored and the chain runs in full: a stale 12h memory must never
     * silence a whole chain forever.
     */
    skip?: Set<string>;
  } = {}
): Promise<NvidiaChatChainResult> {
  const models = chain.filter(Boolean);
  if (models.length === 0) {
    throw new Error('nvidiaChatChain: empty model chain');
  }

  const allSkipped = opts.skip && models.every((m) => opts.skip!.has(m.id));
  const skip = allSkipped ? undefined : opts.skip;

  let last: NvidiaChatResult | null = null;
  let lastModel = models[0];
  const errors: string[] = [];
  const gone: string[] = [];
  const attempts: { id: string; status: number; ms: number }[] = [];
  let usedFallbackIndex = -1;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    if (skip?.has(model.id)) continue;
    // The tick's hard deadline caps EVERY link, not just the first: a 5-model
    // chain at 45 s a link is almost four minutes, and the tick lock only
    // lives 115 s — past it, the next cron tick would run alongside this one
    // and both would write the world. See setCallDeadline().
    const left = callDeadline === null ? Infinity : callDeadline - Date.now();
    if (left < MIN_USEFUL_CALL_MS) {
      errors.push(`${model.id}: skipped (tick deadline)`);
      break;
    }
    const temperature = req.temperature ?? Math.max(0.5, model.goodTemp + (req.tempOffset ?? 0));
    const startedAt = Date.now();
    const res = await nvidiaChat(
      apiKey,
      { ...req, model: model.id, temperature },
      { timeoutMs: Math.min(opts.timeoutMs ?? 30000, left - 1000), retries: 0 }
    );
    attempts.push({ id: model.id, status: res.status, ms: Date.now() - startedAt });
    if (res.status === 404 || res.status === 410) gone.push(model.id);

    if (res.ok && (!opts.accept || opts.accept(res.text))) {
      return { ...res, model, usedFallback: attempts.length > 1 || i > 0, gone, attempts };
    }
    // Keep a usable-transport result as the last resort even if it failed `accept`,
    // so the caller still gets real text (and tokens) to fall back on.
    last = res;
    lastModel = model;
    if (usedFallbackIndex < 0) usedFallbackIndex = i;
    errors.push(`${model.id}: ${res.ok ? 'rejected by accept()' : (res.error || 'unknown')}`);
  }

  return {
    ...(last ?? { ok: false, text: '', finishReason: 'error', totalTokens: 0, status: 0 }),
    // Report the whole chain's failure, not just the last link's.
    error: errors.join(' | ').slice(0, 300),
    model: lastModel,
    usedFallback: false,
    gone,
    attempts,
  };
}
