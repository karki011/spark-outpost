export class RunEventHub {
  private readonly waiters = new Map<string, Set<() => void>>();

  notify(runId: string): void {
    const waiting = this.waiters.get(runId);
    if (!waiting) return;
    this.waiters.delete(runId);
    waiting.forEach((resolve) => resolve());
  }

  waitFor(runId: string, timeoutMs: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const waiting = this.waiters.get(runId) ?? new Set<() => void>();
      this.waiters.set(runId, waiting);
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        waiting.delete(done);
        if (waiting.size === 0 && this.waiters.get(runId) === waiting) this.waiters.delete(runId);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      signal.addEventListener('abort', done, { once: true });
      waiting.add(done);
    });
  }
}
