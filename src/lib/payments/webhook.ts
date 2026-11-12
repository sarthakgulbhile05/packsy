import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Building blocks for provider webhooks. A real adapter uses its provider's documented scheme; these cover the common
// "HMAC-SHA256 over timestamp.body" pattern and the rules every scheme needs: fail closed, constant-time comparison,
// reject old replays, and process each event id once.

/** Constant-time string comparison. Hashing first makes the comparison length-independent too. */
export function timingSafeEqualString(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

/** The signature a sender computes: hex HMAC-SHA256 of `${timestamp}.${rawBody}`. */
export const signWebhook = (secret: string, timestamp: string, rawBody: string) => createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");

export type WebhookCheck =
  | { ok: true }
  | { ok: false; reason: "missing_secret" | "missing_signature" | "bad_timestamp" | "stale" | "bad_signature" };

/**
 * Verifies a webhook against the exact raw body (never a re-serialised JSON object). Fails closed: no secret, no
 * signature or a malformed timestamp is a rejection. `toleranceSeconds` limits replays of an old, valid message.
 */
export function verifyWebhookSignature(input: {
  rawBody: string;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  secret: string | null | undefined;
  nowMs: number;
  toleranceSeconds?: number;
}): WebhookCheck {
  const { rawBody, signature, timestamp, secret, nowMs, toleranceSeconds = 300 } = input;
  if (!secret) return { ok: false, reason: "missing_secret" };
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return { ok: false, reason: "missing_signature" };
  if (!timestamp || !/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "bad_timestamp" };
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > toleranceSeconds) return { ok: false, reason: "stale" };
  return timingSafeEqualString(signWebhook(secret, timestamp, rawBody), signature.toLowerCase()) ? { ok: true } : { ok: false, reason: "bad_signature" };
}

/** A store that remembers which keys were used. `claim` returns true only the first time a key is seen. */
export type IdempotencyStore = { claim(key: string): Promise<boolean> };

/**
 * In-memory store, for tests and single-process use.
 * shortcut: memory is per server instance and lost on restart; real payments need a database table with a unique key
 * (Phase B), claimed in the same transaction as the state change.
 */
export function memoryIdempotencyStore(): IdempotencyStore {
  const used = new Set<string>();
  return {
    claim: async (key) => {
      if (used.has(key)) return false;
      used.add(key);
      return true;
    },
  };
}

/**
 * The key for one money operation. Deterministic, so a retried request reuses its key and the provider (and the store)
 * treat it as the same operation instead of creating a second payment, refund or payout.
 */
export function idempotencyKey(kind: "payment" | "refund" | "payout", transactionId: string, attempt: number): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(transactionId) || !Number.isSafeInteger(attempt) || attempt < 1) throw new Error("Invalid idempotency key input.");
  return `orbitly:${kind}:${transactionId}:${attempt}`;
}

/** Runs `handler` once per key. A repeat returns `{ duplicate: true }` without running it. */
export async function once<T>(store: IdempotencyStore, key: string, handler: () => Promise<T>): Promise<{ duplicate: true } | { duplicate: false; value: T }> {
  if (!(await store.claim(key))) return { duplicate: true };
  return { duplicate: false, value: await handler() };
}
