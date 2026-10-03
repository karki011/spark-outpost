import type { StoredRunEvent } from '@spark-outpost/contracts';

const MAX_CACHED_FRAMES = 2_000;
const MAX_CACHED_CHARS = 4_000_000;

function eventFrame(stored: StoredRunEvent): string {
  return `id: ${stored.seq}\ndata: ${JSON.stringify(stored.event)}\n\n`;
}

export class RunEventHub {
  private readonly waiters = new Map<string, Set<() => void>>();
  private readonly frames = new Map<string, string>();
  private cachedChars = 0;

  notify(runId: string): void {
    const waiting = this.waiters.get(runId);
    if (!waiting) return;
    this.waiters.delete(runId);
    waiting.forEach((resolve) => resolve());
  }

  frame(runId: string, stored: StoredRunEvent): string {
    const key = `${runId}:${stored.seq}`;
    const cached = this.frames.get(key);
    if (cached !== undefined) return cached;
    const frame = eventFrame(stored);
    this.frames.set(key, frame);
    this.cachedChars += frame.length;
    this.evictOldFrames();
    return frame;
  }

  private evictOldFrames(): void {
    while (this.frames.size > MAX_CACHED_FRAMES || this.cachedChars > MAX_CACHED_CHARS) {
      const [oldest, frame] = this.frames.entries().next().value!;
      this.frames.delete(oldest);
      this.cachedChars -= frame.length;
    }
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
