// The bindings every Lumora Build (LB) integration needs. See docs/LB-INTEGRATION.md.
export interface LbEnv {
  DB: D1Database;
  /** Service binding to the `id` worker (LB sign-in). */
  AUTH_SERVICE?: Fetcher;
  /** Service binding to the `coin` worker (LB credits). */
  COIN?: Fetcher;
  /** 'allow' enables the local-only fake sign-in + stubbed coin (never set in production). */
  DEV_FAKE_AUTH?: string;
  /** Worker secret: the master key for encrypting donated API keys. */
  LIVINGCORE_ENCRYPTION_KEY?: string;
  NVIDIA_API_KEY?: string;
}
