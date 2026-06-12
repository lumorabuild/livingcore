// NVIDIA API (build.nvidia.com) — OpenAI-compatible chat completions.
// One key, one endpoint (https://integrate.api.nvidia.com/v1); the model is just a
// string in the request body. The registry below holds every model validated with
// our key, so livingcore (and future projects) can pick any of them by short name.
//
// The key lives ONLY in the Worker secret NVIDIA_API_KEY (wrangler secret put) and
// .dev.vars locally — never in code or git.

export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export interface NvidiaModelInfo {
  id: string;            // value for the API's "model" field
  label: string;
  family: string;
  // Defaults that behave well for THIS model (kimi melts down above ~0.6, etc.)
  goodTemp: number;
  maxTokens: number;
  notes: string;
}

// All 8 validated models. livingcore uses llama-4-maverick (Kevin) and
// ministral-14b (Jenny); the rest are ready for other projects via this registry.
export const NVIDIA_MODELS: Record<string, NvidiaModelInfo> = {
  'llama-3.2-11b-vision': {
    id: 'meta/llama-3.2-11b-vision-instruct',
    label: 'Llama 3.2 11B Vision',
    family: 'meta',
    goodTemp: 0.8,
    maxTokens: 1024,
    notes: 'Fastest of the set and supports vision (image_url content parts; ' +
      'nvidiaChat currently sends text-only messages)',
  },
  'mistral-nemotron': {
    id: 'mistralai/mistral-nemotron',
    label: 'Mistral Nemotron',
    family: 'mistral',
    goodTemp: 0.7,
    maxTokens: 1024,
    notes: 'Mistral+NVIDIA collab. Fast once warm, but cold starts can exceed 90s — ' +
      'use generous timeouts on the first call (verified 2026-06-12)',
  },
  'nemotron-nano-8b': {
    id: 'nvidia/llama-3.1-nemotron-nano-8b-v1',
    label: 'Nemotron Nano 8B',
    family: 'nvidia',
    goodTemp: 0.7,
    maxTokens: 1024,
    notes: "NVIDIA's in-house nano — fast, balanced",
  },
  'nemotron-mini-4b': {
    id: 'nvidia/nemotron-mini-4b-instruct',
    label: 'Nemotron Mini 4B',
    family: 'nvidia',
    goodTemp: 0.7,
    maxTokens: 1024,
    notes: 'Smallest and fastest — simple tasks',
  },
  'ministral-14b': {
    id: 'mistralai/ministral-14b-instruct-2512',
    label: 'Ministral 14B',
    family: 'mistral',
    goodTemp: 0.8,
    maxTokens: 1024,
    notes: 'Lively, stable chat voice — Jenny',
  },
  'llama-3.1-8b': {
    id: 'meta/llama-3.1-8b-instruct',
    label: 'Llama 3.1 8B',
    family: 'meta',
    goodTemp: 0.8,
    maxTokens: 1024,
    notes: 'Classic workhorse, highest throughput',
  },
  'kimi-k2.6': {
    id: 'moonshotai/kimi-k2.6',
    label: 'Kimi K2.6',
    family: 'moonshot',
    goodTemp: 0.6,
    maxTokens: 1500,
    notes: 'Reasoning MoE. CAUTION: this NIM deployment collapses into repetition ' +
      'garbage on persona/chat prompts (verified 2026-06-12) — test before relying on it.',
  },
  'llama-4-maverick': {
    id: 'meta/llama-4-maverick-17b-128e-instruct',
    label: 'Llama 4 Maverick 17B',
    family: 'meta',
    goodTemp: 0.85,
    maxTokens: 1024,
    notes: 'Most capable of the set — Kevin',
  },
};

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
  const timeoutMs = opts.timeoutMs ?? 60000;
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
