// shortcut: in-memory, so limits are per server process. Several instances (or serverless cold starts)
// each get their own budget; move to a shared store (e.g. Redis/Upstash) before relying on it in production.

type Options = { perKey: number; global: number; windowMs: number; maxInFlight: number; maxKeys?: number };
export type Limited = "rate" | "busy";

/** Sliding-window limit per key plus a global limit and a cap on concurrent tasks. */
export function createLimiter({ perKey, global, windowMs, maxInFlight, maxKeys = 10_000 }: Options) {
  const hits = new Map<string, number[]>();
  let all: number[] = [];
  let inFlight = 0;

  return async function run<T>(key: string, task: () => Promise<T>, now = Date.now()): Promise<{ value: T } | { limited: Limited }> {
    const since = now - windowMs;
    all = all.filter((t) => t > since);
    const mine = (hits.get(key) ?? []).filter((t) => t > since);
    if (mine.length >= perKey || all.length >= global) return { limited: "rate" };
    if (inFlight >= maxInFlight) return { limited: "busy" };

    if (!hits.has(key) && hits.size >= maxKeys) {
      for (const [k, times] of hits) if (times.every((t) => t <= since)) hits.delete(k);
      if (hits.size >= maxKeys) return { limited: "busy" }; // memory bound; the global limit still applies
    }
    hits.set(key, [...mine, now]);
    all.push(now);
    inFlight++;
    try {
      return { value: await task() };
    } finally {
      inFlight--;
    }
  };
}
