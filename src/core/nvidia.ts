// NVIDIA API (build.nvidia.com) — OpenAI-compatible chat completions.
// One key, one endpoint (https://integrate.api.nvidia.com/v1); the model is just a
// string in the request body. The registry below holds every model validated with
// our key, so livingcore (and future projects) can pick any of them by short name.
//
// The key lives ONLY in the Worker secret NVIDIA_API_KEY (wrangler secret put) and
// .dev.vars locally — never in code or git.

export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

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
 */
export const REGISTRY_VERIFIED_ON = '2026-07-17';

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
    status: 'ok',
    notes: 'Most capable of the working set and still ~2s at 700 output tokens — Kevin. ' +
      'Warm, expressive persona voice; uses the [remember: …] tool correctly (verified 2026-07-17)',
  },
  'llama-3.1-8b': {
    id: 'meta/llama-3.1-8b-instruct',
    label: 'Llama 3.1 8B',
    family: 'meta',
    goodTemp: 0.8,
    maxTokens: 1024,
    status: 'ok',
    notes: 'Classic workhorse, highest throughput (~0.8s). Lively, in-character chat ' +
      'voice — Jenny (verified 2026-07-17)',
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
    goodTemp: 0.7,
    maxTokens: 1024,
    status: 'unavailable',
    notes: 'Mistral+NVIDIA collab. Worked 2026-06-12; now answers once then 400s with ' +
      "\"Function id … \" — the NIM deployment is flapping (2026-07-17). Do not rely on it.",
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
}

const CHARS_PER_TOKEN = 3.5; // overcount slightly when no usage block is returned

function estimateTokens(messages: NvidiaChatMessage[], output: string): number {
  const inputChars = messages.reduce((n, m) => n + m.content.length, 0);
  return Math.ceil((inputChars + output.length) / CHARS_PER_TOKEN);
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
  });

  let lastError = '';
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

      if (!res.ok) {
        lastError = `HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`;
        // 4xx (except 429) won't get better on retry
        if (res.status !== 429 && res.status < 500) break;
        continue;
      }

      const data: any = await res.json();
      const choice = data?.choices?.[0];
      // Reasoning models (kimi) put thinking in a separate field; we only want content.
      const text: string = typeof choice?.message?.content === 'string' ? choice.message.content.trim() : '';
      const finishReason: string = choice?.finish_reason || '';
      const totalTokens: number =
        typeof data?.usage?.total_tokens === 'number'
          ? data.usage.total_tokens
          : estimateTokens(req.messages, text);

      if (!text) {
        lastError = `empty content (finish: ${finishReason || 'unknown'})`;
        continue;
      }

      return { ok: true, text, finishReason, totalTokens };
    } catch (err) {
      lastError = String(err).slice(0, 200);
    }
  }

  return { ok: false, text: '', finishReason: 'error', totalTokens: 0, error: lastError };
}

export interface NvidiaChatChainResult extends NvidiaChatResult {
  /** The model that actually produced `text` — may not be the first one asked. */
  model: NvidiaModelInfo;
  /** True when the primary was skipped over and a fallback answered instead. */
  usedFallback: boolean;
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
  } = {}
): Promise<NvidiaChatChainResult> {
  const models = chain.filter(Boolean);
  if (models.length === 0) {
    throw new Error('nvidiaChatChain: empty model chain');
  }

  let last: NvidiaChatResult | null = null;
  let lastModel = models[0];
  const errors: string[] = [];

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const temperature = req.temperature ?? Math.max(0.5, model.goodTemp + (req.tempOffset ?? 0));
    const res = await nvidiaChat(
      apiKey,
      { ...req, model: model.id, temperature },
      { timeoutMs: opts.timeoutMs, retries: 0 }
    );
    if (res.ok && (!opts.accept || opts.accept(res.text))) {
      return { ...res, model, usedFallback: i > 0 };
    }
    // Keep a usable-transport result as the last resort even if it failed `accept`,
    // so the caller still gets real text (and tokens) to fall back on.
    last = res;
    lastModel = model;
    errors.push(`${model.id}: ${res.ok ? 'rejected by accept()' : (res.error || 'unknown')}`);
  }

  return {
    ...(last as NvidiaChatResult),
    // Report the whole chain's failure, not just the last link's.
    error: errors.join(' | ').slice(0, 300),
    model: lastModel,
    usedFallback: false,
  };
}
