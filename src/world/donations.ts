// ─────────────────────────────────────────────────────────────────────────────
// LEND A MIND — donated AI models (SPEC4 §A3, "BYOK").
//
// A signed-in Lumora Build patron may donate their OWN model + API key so
// Kevin, Jenny or the narrator think with it for a while. The donor's
// provider bills THEM, never this project (src/core/nvidia.ts's own header
// states the one exception this file is). Every donated call is still just
// one more entry `nvidiaChatChain` (core/nvidia.ts) tries, in front of the
// project's own free NVIDIA chain, which always remains the permanent
// fallback — see donatedChain() below.
//
// Crypto mirrors `id`'s own `apps/master-auth/src/crypto.ts` pattern
// (AES-256-GCM, IV fresh per record, `v1.<iv>.<ct>` stored format) with one
// addition scratchpad/patrons/byok.md §1 recommends: AAD = the row's own id,
// so a ciphertext copied into a different donation's `key_enc` column fails
// to decrypt instead of silently "working" against the wrong donor's scope.
// The id doesn't exist until after INSERT, so addDonation() below inserts a
// placeholder row, encrypts against the real id, then fills it in — there is
// no window where a half-written row is ever selectable (key_enc='' always
// fails to decrypt, so donatedChain() just skips it).
//
// Schema self-heals here (same pattern as src/lb/patrons.ts / world/gifts.ts
// — never in world/store.ts's ensureIslandSchema, this table isn't the
// engine's). migrations/0011_donations.sql mirrors it for a fresh local D1.
// ─────────────────────────────────────────────────────────────────────────────

import type { AgentId } from './types';
import type { LbEnv } from '../lb/env';
import { getPatron, patronLabel } from '../lb/patrons';
import { NvidiaModelInfo, nvidiaChat, type ChainAttempt } from '../core/nvidia';
import { initWorld } from './sim';
import { chainFor } from './models';
import { agentSystemPrompt, sceneOpening } from './prompts';
// parseTurn is the exact bar a real turn has to clear (SPEC4 §A3: "require a
// parseable THOUGHT/SAY/DO reply") — reusing it here (rather than a second,
// looser check) means a donated key can never be stored on a weaker promise
// than the one every free-chain reply already has to keep. agent.ts also
// imports FROM this file (donatedChain/recordChainDonations),
// so this is a deliberate two-way import between agent.ts and donations.ts —
// safe because every shared binding here is a function, never a value read
// at module-evaluation time.
import { parseTurn } from './agent';

function nowIso(): string {
  return new Date().toISOString().slice(0, 19) + 'Z';
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Roles + provider allowlist ──
//
// `role` decides WHO thinks with the donated model — 'kevin' | 'jenny' feed
// straight into agent.ts's speak()/dialogue chain, 'narrator' feeds the
// narrator's transition/morning-setup calls in narrator.ts. Never a fourth
// value: nothing in this codebase writes dialogue or adjudicates the world
// except those three.
export type DonationRole = 'kevin' | 'jenny' | 'narrator';

// NO CUSTOM BASE URLs, ever (SPEC4's own non-negotiable rule) — a donor picks
// a `provider` from this fixed enum and types a `model` string; nothing here
// ever reaches fetch() with an attacker-controlled scheme/host. This is the
// whole SSRF mitigation, by construction, not a check to remember to run.
export type Provider =
  | 'openai' | 'anthropic' | 'google' | 'openrouter' | 'groq' | 'together'
  | 'mistral' | 'deepseek' | 'xai' | 'nvidia' | 'fireworks' | 'cerebras';

interface ProviderInfo {
  label: string;
  baseUrl: string;
  modelPlaceholder: string;
  /** OpenAI's reasoning models (o*, gpt-5*) take `max_completion_tokens`, not `max_tokens` — see byok.md §2. */
  useMaxCompletionTokens?: (modelId: string) => boolean;
}

// Base URLs + one-line quirks researched in scratchpad/patrons/byok.md §2.
// Every provider here speaks the same OpenAI-compatible
// `POST {base}/chat/completions` shape nvidia.ts's client already implements
// — that's what makes ONE generalized client (core/nvidia.ts) cover all
// twelve rather than needing a bespoke SDK per provider.
export const PROVIDERS: Record<Provider, ProviderInfo> = {
  openai: {
    label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', modelPlaceholder: 'gpt-5-mini',
    useMaxCompletionTokens: (id) => /^(o\d|gpt-5)/i.test(id),
  },
  anthropic: {
    label: 'Anthropic (OpenAI-compatible)', baseUrl: 'https://api.anthropic.com/v1',
    modelPlaceholder: 'claude-sonnet-4-6',
  },
  google: {
    label: 'Google Gemini (OpenAI-compatible)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelPlaceholder: 'gemini-3.0-flash',
  },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', modelPlaceholder: 'anthropic/claude-sonnet-4.6' },
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', modelPlaceholder: 'llama-3.3-70b-versatile' },
  together: { label: 'Together', baseUrl: 'https://api.together.xyz/v1', modelPlaceholder: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  mistral: { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', modelPlaceholder: 'mistral-large-latest' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', modelPlaceholder: 'deepseek-chat' },
  xai: { label: 'xAI', baseUrl: 'https://api.x.ai/v1', modelPlaceholder: 'grok-4' },
  nvidia: { label: 'NVIDIA NIM (your own key)', baseUrl: 'https://integrate.api.nvidia.com/v1', modelPlaceholder: 'nvidia/nemotron-3-super-120b-a12b' },
  fireworks: { label: 'Fireworks', baseUrl: 'https://api.fireworks.ai/inference/v1', modelPlaceholder: 'accounts/fireworks/models/llama-v3p3-70b-instruct' },
  cerebras: { label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', modelPlaceholder: 'llama-3.3-70b' },
};

export const CONSENT_VERSION = 'lend-a-mind-2026-09-26';

// ── Which models a donor may name ──
//
// The prompts are ours, so a PUBLIC base model cannot be told what to say. A
// model the donor built or configured can: an OpenAI/Mistral fine-tune
// (`ft:…`), a Gemini tuned model, an OpenRouter preset (`@preset/…`, which
// carries its own system prompt), a Fireworks account deployment, or a
// Together upload. Any of those would let one donor write Kevin's or Jenny's
// public words verbatim — so only base-model shapes are accepted, and on the
// two hosts with open namespaces only the vendors' own public ones.
const MODEL_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const TOGETHER_VENDORS = [
  'meta-llama', 'mistralai', 'qwen', 'deepseek-ai', 'google', 'nvidia', 'microsoft',
  'moonshotai', 'zai-org', 'openai', 'nousresearch', 'arcee-ai', 'togethercomputer',
];

export function modelAllowed(provider: Provider, model: string): boolean {
  if (!MODEL_SHAPE.test(model)) return false;
  const m = model.toLowerCase();
  if (m.startsWith('ft:') || m.includes(':ft') || m.startsWith('tunedmodels/')) return false;
  // OpenRouter's `:online` variant searches the web and pastes what it finds.
  if (m.endsWith(':online')) return false;
  if (provider === 'fireworks') return m.startsWith('accounts/fireworks/models/');
  if (provider === 'together') return TOGETHER_VENDORS.some((v) => m.startsWith(`${v}/`));
  return true;
}

// Limits, per SPEC4 §A3's money-safety section.
const CALLS_PER_DAY_DEFAULT = 200, CALLS_PER_DAY_MIN = 10, CALLS_PER_DAY_MAX = 2000;
const TOKENS_PER_DAY_DEFAULT = 300000, TOKENS_PER_DAY_MIN = 10000, TOKENS_PER_DAY_MAX = 3000000;
/** Auto-pause after this many CONSECUTIVE real-use failures — never silently reactivates (spec §A3). */
const FAIL_STREAK_LIMIT = 5;

function clampCallsPerDay(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return CALLS_PER_DAY_DEFAULT;
  return Math.max(CALLS_PER_DAY_MIN, Math.min(CALLS_PER_DAY_MAX, v));
}
function clampTokensPerDay(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return TOKENS_PER_DAY_DEFAULT;
  return Math.max(TOKENS_PER_DAY_MIN, Math.min(TOKENS_PER_DAY_MAX, v));
}

// ── Schema (self-healing, memoised per isolate) ──

let schemaReady = false;
export async function ensureDonationsSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS model_donations (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id TEXT NOT NULL,
       provider TEXT NOT NULL,
       model TEXT NOT NULL,
       role TEXT NOT NULL,
       key_enc TEXT NOT NULL DEFAULT '',
       key_preview TEXT NOT NULL DEFAULT '',
       status TEXT NOT NULL DEFAULT 'active',
       calls_per_day INTEGER NOT NULL DEFAULT ${CALLS_PER_DAY_DEFAULT},
       tokens_per_day INTEGER NOT NULL DEFAULT ${TOKENS_PER_DAY_DEFAULT},
       fail_streak INTEGER NOT NULL DEFAULT 0,
       last_error TEXT,
       validated_at TEXT,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       consent_version TEXT NOT NULL
     )`
  ).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_model_donations_user ON model_donations(user_id)`).run().catch(() => {});
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_model_donations_role_status ON model_donations(role, status)`).run().catch(() => {});
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS donation_usage (
       donation_id INTEGER NOT NULL,
       day TEXT NOT NULL,
       calls INTEGER NOT NULL DEFAULT 0,
       tokens INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (donation_id, day)
     )`
  ).run().catch(() => {});
  schemaReady = true;
}

// ── Crypto (AES-256-GCM, v1.<iv>.<ct>, AAD = the donation's own row id) ──

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function deriveKey(masterKey: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(masterKey));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptDonationKey(plaintext: string, donationId: string, masterKey: string): Promise<string> {
  const key = await deriveKey(masterKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(donationId);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, new TextEncoder().encode(plaintext))
  );
  return `v1.${b64urlEncode(iv)}.${b64urlEncode(ct)}`;
}

/** Never returns the wrong donor's key: a ciphertext whose AAD (row id) doesn't match `donationId` fails to decrypt, same as a corrupted one — both come back null. */
export async function decryptDonationKey(stored: string, donationId: string, masterKey: string): Promise<string | null> {
  if (!stored) return null;
  const parts = stored.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  try {
    const key = await deriveKey(masterKey);
    const iv = b64urlDecode(parts[1]);
    const ct = b64urlDecode(parts[2]);
    const aad = new TextEncoder().encode(donationId);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/** `••••<last4> (<first8 hex of sha256>)` — the ONLY form of the key ever shown again after entry. */
export async function keyFingerprint(plaintext: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plaintext));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const last4 = plaintext.slice(-4);
  return `••••${last4} (${hex.slice(0, 8)})`;
}

/** Never let a provider's own error text (which sometimes echoes the key back, e.g. in a 401 body) reach last_error, a UI or a log verbatim. */
function sanitizeError(raw: string, exactKey?: string): string {
  let s = (raw || 'unknown error').slice(0, 500);
  if (exactKey && exactKey.length >= 6) s = s.split(exactKey).join('[redacted]');
  s = s.replace(/\b(sk|pk|rk|gsk)-[A-Za-z0-9_-]{6,}\b/gi, '[redacted]');
  s = s.replace(/\bAIza[0-9A-Za-z_-]{10,}\b/g, '[redacted]');
  s = s.replace(/Bearer\s+[A-Za-z0-9._-]{10,}/gi, 'Bearer [redacted]');
  return s.slice(0, 300);
}

// ── Validation (spec §A3: "one real, tiny call... require a parseable THOUGHT/SAY/DO reply") ──

function validationMessages(role: DonationRole): { role: 'system' | 'user'; content: string }[] {
  // A fixed, harmless fixture world/scene — this is a connectivity + format
  // probe, never a real turn: nothing it produces is stored, shown, or fed
  // back into the island. AgentContext only accepts 'kevin'|'jenny' (the
  // narrator has no persona/body of its own), so a 'narrator' donation is
  // proven with Kevin's own voice — the point is proving the KEY+MODEL can
  // hold the THOUGHT/SAY/DO shape every real call depends on, not simulating
  // narration specifically.
  const agent: AgentId = role === 'jenny' ? 'jenny' : 'kevin';
  const w = initWorld('2026-01-01T06:00:00Z');
  const setup = 'A quiet moment on the veranda. Nothing urgent is happening.';
  const system = agentSystemPrompt({
    world: w, agent, journal: '', memories: [], notebook: [], earlierToday: [], setup,
  });
  return [
    { role: 'system', content: system },
    { role: 'user', content: sceneOpening(setup) },
  ];
}

async function probeDonation(
  provider: Provider, model: string, apiKey: string, role: DonationRole
): Promise<{ ok: true } | { ok: false; error: string }> {
  const info = PROVIDERS[provider];
  const messages = validationMessages(role);
  const res = await nvidiaChat(
    apiKey,
    { model, messages, maxTokens: 200, temperature: 0.7, useMaxCompletionTokens: info.useMaxCompletionTokens?.(model) },
    { timeoutMs: 20000, retries: 0, baseUrl: info.baseUrl }
  );
  if (!res.ok) return { ok: false, error: sanitizeError(res.error || `HTTP ${res.status}`, apiKey) };
  const parsed = parseTurn(res.text, role === 'jenny' ? 'jenny' : 'kevin');
  if (!parsed.say.trim() && !parsed.do.trim()) {
    return { ok: false, error: 'The model answered, but not in a usable reply shape — try a different model.' };
  }
  return { ok: true };
}

// ── CRUD ──

export interface PublicDonationRow {
  id: number;
  provider: Provider;
  model: string;
  role: DonationRole;
  key_preview: string;
  status: 'active' | 'paused' | 'paused_errors' | 'revoked';
  calls_per_day: number;
  tokens_per_day: number;
  calls_today: number;
  tokens_today: number;
  fail_streak: number;
  last_error: string | null;
  validated_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function addDonation(
  env: LbEnv,
  a: {
    userId: string; provider: string; model: string; role: string; apiKey: string;
    callsPerDay?: number; tokensPerDay?: number; consentVersion: string;
  }
): Promise<{ ok: true; donation: PublicDonationRow } | { ok: false; error: string }> {
  if (!env.LIVINGCORE_ENCRYPTION_KEY) return { ok: false, error: 'disabled' };
  const db = env.DB;
  await ensureDonationsSchema(db);

  const provider = a.provider as Provider;
  if (!PROVIDERS[provider]) return { ok: false, error: 'invalid_provider' };
  const role = a.role as DonationRole;
  if (role !== 'kevin' && role !== 'jenny' && role !== 'narrator') return { ok: false, error: 'invalid_role' };
  const model = (a.model || '').trim();
  if (!model) return { ok: false, error: 'invalid_model' };
  if (!modelAllowed(provider, model)) return { ok: false, error: 'model_not_allowed' };
  // Kevin and Jenny never share a model (ISLAND.md), so a donation of the OTHER
  // character's own model could never be picked — say so now, not never.
  if (role !== 'narrator' && model.toLowerCase() === chainFor(role === 'kevin' ? 'jenny' : 'kevin')[0].id.toLowerCase()) {
    return { ok: false, error: 'same_as_partner' };
  }
  const apiKey = (a.apiKey || '').trim();
  if (apiKey.length < 8 || apiKey.length > 400) return { ok: false, error: 'invalid_key' };
  if (!a.consentVersion) return { ok: false, error: 'consent_required' };

  const callsPerDay = clampCallsPerDay(a.callsPerDay);
  const tokensPerDay = clampTokensPerDay(a.tokensPerDay);

  // A failing key is NEVER stored (spec §A3) — prove it works, on THIS
  // model, in THIS reply shape, before any row exists at all.
  const probe = await probeDonation(provider, model, apiKey, role);
  if (!probe.ok) return { ok: false, error: probe.error };

  const now = nowIso();
  // AAD-bind the ciphertext to its OWN row id (see this file's header) — the
  // id doesn't exist until after INSERT, so: insert a placeholder, encrypt
  // against the real id, then fill it in. key_enc='' can never decrypt, so
  // there's no window where a half-written row is usable.
  const insertRes = await db.prepare(
    `INSERT INTO model_donations
       (user_id, provider, model, role, key_enc, key_preview, status, calls_per_day, tokens_per_day,
        fail_streak, last_error, validated_at, created_at, updated_at, consent_version)
     VALUES (?, ?, ?, ?, '', '', 'active', ?, ?, 0, NULL, ?, ?, ?, ?)`
  ).bind(a.userId, provider, model, role, callsPerDay, tokensPerDay, now, now, now, a.consentVersion).run();
  const id = insertRes.meta.last_row_id;
  if (!id) return { ok: false, error: 'error' };

  const keyEnc = await encryptDonationKey(apiKey, String(id), env.LIVINGCORE_ENCRYPTION_KEY);
  const preview = await keyFingerprint(apiKey);
  try {
    await db.prepare(`UPDATE model_donations SET key_enc = ?, key_preview = ? WHERE id = ?`).bind(keyEnc, preview, id).run();
  } catch {
    // Never leave a keyless "active" row behind for the donor to wonder about.
    await db.prepare(`DELETE FROM model_donations WHERE id = ? AND key_enc = ''`).bind(id).run().catch(() => {});
    return { ok: false, error: 'error' };
  }

  return {
    ok: true,
    donation: {
      id, provider, model, role, key_preview: preview, status: 'active',
      calls_per_day: callsPerDay, tokens_per_day: tokensPerDay, calls_today: 0, tokens_today: 0,
      fail_streak: 0, last_error: null, validated_at: now, created_at: now, updated_at: now,
    },
  };
}

/** No keys, ever — not even encrypted ones. */
export async function listDonations(env: LbEnv, userId: string): Promise<PublicDonationRow[]> {
  await ensureDonationsSchema(env.DB);
  const today = todayKey();
  const rows = await env.DB.prepare(
    `SELECT d.id as id, d.provider as provider, d.model as model, d.role as role, d.key_preview as key_preview,
            d.status as status, d.calls_per_day as calls_per_day, d.tokens_per_day as tokens_per_day,
            d.fail_streak as fail_streak, d.last_error as last_error, d.validated_at as validated_at,
            d.created_at as created_at, d.updated_at as updated_at,
            COALESCE(u.calls, 0) as calls_today, COALESCE(u.tokens, 0) as tokens_today
     FROM model_donations d LEFT JOIN donation_usage u ON u.donation_id = d.id AND u.day = ?
     WHERE d.user_id = ? AND d.status != 'revoked'
     ORDER BY d.id DESC LIMIT 50`
  ).bind(today, userId).all<PublicDonationRow>();
  return rows.results || [];
}

export async function updateDonation(
  env: LbEnv, id: number, userId: string,
  patch: { action?: 'pause' | 'resume'; calls_per_day?: number; tokens_per_day?: number }
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureDonationsSchema(env.DB);
  const row = await env.DB.prepare(`SELECT id, user_id, status FROM model_donations WHERE id = ?`)
    .bind(id).first<{ id: number; user_id: string; status: string }>();
  if (!row || row.user_id !== userId) return { ok: false, error: 'not_found' };
  if (row.status === 'revoked') return { ok: false, error: 'revoked' };

  const now = nowIso();
  if (patch.action === 'pause') {
    await env.DB.prepare(`UPDATE model_donations SET status = 'paused', updated_at = ? WHERE id = ?`).bind(now, id).run();
  } else if (patch.action === 'resume') {
    // A MANUAL resume always clears the error streak — the donor is saying
    // "try again" (spec §A3: never auto-reactivate silently, but this isn't
    // that — it's the human doing exactly the thing auto-pause exists to
    // wait for).
    await env.DB.prepare(
      `UPDATE model_donations SET status = 'active', fail_streak = 0, last_error = NULL, updated_at = ? WHERE id = ?`
    ).bind(now, id).run();
  }

  const callsPerDay = patch.calls_per_day !== undefined ? clampCallsPerDay(patch.calls_per_day) : undefined;
  const tokensPerDay = patch.tokens_per_day !== undefined ? clampTokensPerDay(patch.tokens_per_day) : undefined;
  if (callsPerDay !== undefined && tokensPerDay !== undefined) {
    await env.DB.prepare(`UPDATE model_donations SET calls_per_day = ?, tokens_per_day = ?, updated_at = ? WHERE id = ?`)
      .bind(callsPerDay, tokensPerDay, now, id).run();
  } else if (callsPerDay !== undefined) {
    await env.DB.prepare(`UPDATE model_donations SET calls_per_day = ?, updated_at = ? WHERE id = ?`).bind(callsPerDay, now, id).run();
  } else if (tokensPerDay !== undefined) {
    await env.DB.prepare(`UPDATE model_donations SET tokens_per_day = ?, updated_at = ? WHERE id = ?`).bind(tokensPerDay, now, id).run();
  }

  return { ok: true };
}

/** Deletes the encrypted key outright and marks revoked — a revoked donation is never selectable again (donatedChain only ever reads status = 'active'). */
export async function revokeDonation(env: LbEnv, id: number, userId: string): Promise<boolean> {
  await ensureDonationsSchema(env.DB);
  const row = await env.DB.prepare(`SELECT id FROM model_donations WHERE id = ? AND user_id = ?`).bind(id, userId).first<{ id: number }>();
  if (!row) return false;
  await env.DB.prepare(`UPDATE model_donations SET key_enc = '', status = 'revoked', updated_at = ? WHERE id = ?`)
    .bind(nowIso(), id).run();
  return true;
}

// ── Chain selection (agent.ts / narrator.ts) ──

interface DonationCandidateRow {
  id: number; provider: string; model: string; key_enc: string;
  calls_per_day: number; tokens_per_day: number; calls_today: number; tokens_today: number;
}

/**
 * The donors for `role`, least-used-today first, within their own limits —
 * so donors take turns, and nobody wins every turn just by setting a bigger
 * daily budget. At most 2, so a bad donated link can still fall through to
 * another donor before the free chain. `avoidModelIds` keeps Kevin and Jenny
 * off the same model (ISLAND.md's monoculture rule): agent.ts passes the
 * partner's own primary and the model that answered the partner's last turn.
 * A row that can no longer be used (its key won't decrypt after a secret
 * change, or its model is no longer accepted) is PAUSED with a reason the
 * donor sees — never silently skipped, or it would stay first in line forever
 * and block every other donor. Returns [] whenever the feature is off (no
 * encryption key) or nothing is eligible — callers run their free chain.
 */
export async function donatedChain(env: LbEnv, role: DonationRole, avoidModelIds: string[] = []): Promise<NvidiaModelInfo[]> {
  const encKey = env.LIVINGCORE_ENCRYPTION_KEY;
  if (!encKey) return [];
  const db = env.DB;
  await ensureDonationsSchema(db);
  const providers = Object.keys(PROVIDERS);
  const avoid = avoidModelIds.map((m) => m.toLowerCase());
  const rows = await db.prepare(
    `SELECT d.id as id, d.provider as provider, d.model as model, d.key_enc as key_enc,
            d.calls_per_day as calls_per_day, d.tokens_per_day as tokens_per_day,
            COALESCE(u.calls, 0) as calls_today, COALESCE(u.tokens, 0) as tokens_today
     FROM model_donations d LEFT JOIN donation_usage u ON u.donation_id = d.id AND u.day = ?
     WHERE d.role = ? AND d.status = 'active' AND d.key_enc != ''
       AND d.provider IN (${providers.map(() => '?').join(',')})
       AND lower(d.model) NOT IN (${avoid.length ? avoid.map(() => '?').join(',') : "''"})
       AND COALESCE(u.calls, 0) < d.calls_per_day AND COALESCE(u.tokens, 0) < d.tokens_per_day
     ORDER BY COALESCE(u.calls, 0) ASC, d.id ASC LIMIT 50`
  ).bind(todayKey(), role, ...providers, ...avoid).all<DonationCandidateRow>();

  const out: NvidiaModelInfo[] = [];
  for (const r of rows.results || []) {
    if (out.length >= 2) break;
    const info = PROVIDERS[r.provider as Provider];
    if (!modelAllowed(r.provider as Provider, r.model)) {
      await pauseDonation(db, r.id, 'This model is no longer accepted — only public base models can be lent.');
      continue;
    }
    const apiKey = await decryptDonationKey(r.key_enc, String(r.id), encKey);
    if (!apiKey) {
      await pauseDonation(db, r.id, 'The saved key could not be read. Please remove this donation and add it again.');
      continue;
    }
    out.push({
      id: r.model,
      label: `donated:${r.provider}`,
      family: r.provider,
      goodTemp: 0.8,
      maxTokens: 1024,
      status: 'ok',
      notes: `donation #${r.id} — billed to the donor, never to this project`,
      baseUrl: info.baseUrl,
      apiKey,
      useMaxCompletionTokens: info.useMaxCompletionTokens?.(r.model),
      donationId: r.id,
    });
  }
  return out;
}

async function pauseDonation(db: D1Database, id: number, reason: string): Promise<void> {
  await db.prepare(`UPDATE model_donations SET status = 'paused_errors', last_error = ?, updated_at = ? WHERE id = ? AND status = 'active'`)
    .bind(reason, nowIso(), id).run().catch(() => {});
}

/**
 * Records every donated link one chain call actually tried, win or lose, with
 * the tokens THAT attempt cost the donor's key (a reply the caller rejected
 * was still billed). Attempts carry their own donation id, so two donors
 * lending the same model id are never confused with each other or with the
 * project's own copy of it. agent.ts and narrator.ts both call this.
 */
export async function recordChainDonations(env: LbEnv, attempts: ChainAttempt[]): Promise<void> {
  for (const att of attempts) {
    if (att.donationId === undefined) continue;
    const why = att.won ? undefined : att.status === 200 ? 'reply not usable (empty, wrong format, or a link)' : `HTTP ${att.status || 'timeout'}`;
    await recordDonationUse(env, att.donationId, att.tokens, !!att.won, why).catch(() => {});
  }
}

/**
 * Records one attempt against a donation. Auto-pauses at FAIL_STREAK_LIMIT
 * consecutive failures and NEVER auto-reactivates — only
 * updateDonation({action:'resume'}) (a human) clears it (spec §A3).
 */
async function recordDonationUse(env: LbEnv, id: number, tokens: number, ok: boolean, error?: string): Promise<void> {
  const db = env.DB;
  await ensureDonationsSchema(db);
  const today = todayKey();
  const now = nowIso();

  await db.prepare(
    `INSERT INTO donation_usage (donation_id, day, calls, tokens) VALUES (?, ?, 1, ?)
     ON CONFLICT(donation_id, day) DO UPDATE SET calls = calls + 1, tokens = tokens + ?`
  ).bind(id, today, Math.max(0, Math.round(tokens)), Math.max(0, Math.round(tokens))).run().catch(() => {});

  if (ok) {
    await db.prepare(`UPDATE model_donations SET fail_streak = 0, validated_at = ?, updated_at = ? WHERE id = ?`)
      .bind(now, now, id).run().catch(() => {});
    return;
  }

  const row = await db.prepare(`SELECT fail_streak, status FROM model_donations WHERE id = ?`)
    .bind(id).first<{ fail_streak: number; status: string }>();
  if (!row || row.status !== 'active') return; // already paused/revoked — don't resurrect or double-count
  const streak = (row.fail_streak || 0) + 1;
  const sanitized = sanitizeError(error || 'unknown error');
  const nextStatus = streak >= FAIL_STREAK_LIMIT ? 'paused_errors' : 'active';
  await db.prepare(`UPDATE model_donations SET fail_streak = ?, last_error = ?, status = ?, updated_at = ? WHERE id = ?`)
    .bind(streak, sanitized, nextStatus, now, id).run().catch(() => {});
}

// ── Provenance ──

/** The patron's OWN opt-in label for the donation that spoke — 'an unseen friend' by default, same fallback as everywhere else (SPEC4's fiction/names rule). Never a user id or email. */
export async function donationLabel(db: D1Database, id: number): Promise<string> {
  const row = await db.prepare(`SELECT user_id FROM model_donations WHERE id = ?`).bind(id).first<{ user_id: string }>();
  if (!row) return 'an unseen friend';
  const patron = await getPatron(db, row.user_id);
  return patronLabel(patron);
}

// ── /shrine's "minds lent" (spec §A2's ShrinePage calls this) ──

export interface PublicDonor {
  label: string;
  role: DonationRole;
  provider: Provider;
  model: string;
  calls: number;
}

/** Opt-in only (patron.show_name) — a donor who never chose a public name never appears here, same as they never appear on a crate label. */
export async function publicDonors(db: D1Database): Promise<PublicDonor[]> {
  await ensureDonationsSchema(db);
  const rows = await db.prepare(
    `SELECT d.id as id, d.user_id as user_id, d.role as role, d.model as model, d.provider as provider,
            (SELECT COALESCE(SUM(u.calls), 0) FROM donation_usage u WHERE u.donation_id = d.id) as calls
     FROM model_donations d WHERE d.status IN ('active', 'paused', 'paused_errors')
     ORDER BY d.id ASC LIMIT 100`
  ).all<{ id: number; user_id: string; role: DonationRole; model: string; provider: Provider; calls: number }>();

  const out: PublicDonor[] = [];
  for (const r of rows.results || []) {
    const patron = await getPatron(db, r.user_id);
    if (!patron.show_name || !patron.public_name) continue;
    out.push({ label: patronLabel(patron), role: r.role, provider: r.provider, model: r.model, calls: r.calls });
  }
  return out;
}
