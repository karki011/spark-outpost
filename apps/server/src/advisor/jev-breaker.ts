export const JEV_PAUSE_AFTER = 3;
export const JEV_PAUSE_MS = 30_000;
export const JEV_PAUSED = 'Jev is not answering, so Spark is using its rules for a moment.';

export class JevBreaker {
  private failures = 0;
  private pausedUntil = 0;

  constructor(private readonly now: () => number = Date.now) {}

  get paused(): boolean {
    return this.now() < this.pausedUntil;
  }

  succeeded(): void {
    this.failures = 0;
    this.pausedUntil = 0;
  }

  failed(): void {
    this.failures += 1;
    if (this.failures >= JEV_PAUSE_AFTER) this.pausedUntil = this.now() + JEV_PAUSE_MS;
  }
}

const breakers = new WeakMap<typeof fetch, Map<string, JevBreaker>>();

export function breakerFor(fetcher: typeof fetch, baseUrl: string): JevBreaker {
  const byUrl = breakers.get(fetcher) ?? new Map<string, JevBreaker>();
  breakers.set(fetcher, byUrl);
  const breaker = byUrl.get(baseUrl) ?? new JevBreaker();
  byUrl.set(baseUrl, breaker);
  return breaker;
}
