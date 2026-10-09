const LIMIT_WINDOW_MS = 60_000;

export class RateLimitError extends Error {}

export class AttemptWindow {
  private attempts: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly now: () => number,
    private readonly refusal: () => RateLimitError,
  ) {}

  take(): void {
    const since = this.now() - LIMIT_WINDOW_MS;
    this.attempts = this.attempts.filter((at) => at > since);
    if (this.attempts.length >= this.limit) throw this.refusal();
    this.attempts.push(this.now());
  }
}
