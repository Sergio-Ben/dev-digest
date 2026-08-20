import { describe, it, expect } from 'vitest';
import { createSingleFlight } from '../src/platform/single-flight.js';

describe('createSingleFlight (per-process request coalescing)', () => {
  it('invokes fn exactly once for concurrent calls with the same key, and both resolve to the same value', async () => {
    const singleFlight = createSingleFlight<string>();
    let calls = 0;

    const fn = () =>
      new Promise<string>((resolve) => {
        calls++;
        setTimeout(() => resolve('result'), 10);
      });

    const [a, b] = await Promise.all([
      singleFlight('key-1', fn),
      singleFlight('key-1', fn),
    ]);

    expect(calls).toBe(1);
    expect(a).toBe('result');
    expect(b).toBe('result');
  });

  it('does not cache a rejection — the next call for the same key re-invokes fn', async () => {
    const singleFlight = createSingleFlight<string>();
    let calls = 0;

    const failingFn = () => {
      calls++;
      return Promise.reject(new Error('provider outage'));
    };

    await expect(singleFlight('key-2', failingFn)).rejects.toThrow('provider outage');
    expect(calls).toBe(1);

    // The entry must have been deleted on rejection — the next call re-invokes fn.
    const succeedingFn = () => {
      calls++;
      return Promise.resolve('recovered');
    };
    await expect(singleFlight('key-2', succeedingFn)).resolves.toBe('recovered');
    expect(calls).toBe(2);
  });
});
