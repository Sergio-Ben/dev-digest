/**
 * Single-flight (request coalescing) helper: for a given key, if a call is already
 * in flight, concurrent callers await the SAME promise instead of triggering a
 * duplicate call to `fn`. This differs from the fire-and-forget boolean-guard shape
 * used in `platform/price-book.ts` (which lets concurrent callers see stale data
 * while a refresh runs in the background) — here, every caller for a given key
 * awaits the first caller's actual result.
 *
 * The in-flight promise is removed from the map in a `finally`, so a rejection is
 * NEVER cached — the next call for that key re-invokes `fn` from scratch instead of
 * permanently poisoning the key with a failed provider response.
 *
 * IMPORTANT: this is a per-process, in-memory `Map` — it does not coordinate across
 * multiple server processes/instances. It only dedupes concurrent callers within a
 * single Node.js process.
 */
export function createSingleFlight<T>(): (key: string, fn: () => Promise<T>) => Promise<T> {
  const inFlight = new Map<string, Promise<T>>();

  return function singleFlight(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = inFlight.get(key);
    if (existing) return existing;

    const promise = fn().finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, promise);
    return promise;
  };
}
