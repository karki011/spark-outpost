import type { RunStreamEnd, StoredRunEvent } from '@spark-outpost/contracts';

const MAX_CACHED_FRAMES = 2_000;
const MAX_CACHED_CHARS = 4_000_000;

type Listener = (runId: string) => void;

function eventFrame(runId: string, stored: StoredRunEvent): string {
  return `data: ${JSON.stringify({ runId, seq: stored.seq, event: stored.event })}\n\n`;
}

export function endFrame(runId: string, end: RunStreamEnd): string {
  return `data: ${JSON.stringify({ runId, end })}\n\n`;
}

export class RunWatch {
  private readonly pending = new Set<string>();
  private readonly watched = new Set<string>();
  private wake: (() => void) | null = null;

  constructor(
    private readonly hub: RunEventHub,
    runIds: Iterable<string>,
  ) {
    for (const runId of runIds) {
      this.watched.add(runId);
      this.pending.add(runId);
      hub.listen(runId, this.mark);
    }
  }

  get size(): number {
    return this.watched.size;
  }

  take(): string[] {
    const runIds = [...this.pending].filter((runId) => this.watched.has(runId));
    this.pending.clear();
    return runIds;
  }

  again(runId: string): void {
    this.pending.add(runId);
  }

  drop(runId: string): void {
    this.watched.delete(runId);
    this.hub.unlisten(runId, this.mark);
  }

  close(): void {
    for (const runId of [...this.watched]) this.drop(runId);
    this.wake?.();
  }

  async changed(timeoutMs: number, signal: AbortSignal): Promise<void> {
    if (this.pending.size > 0 || signal.aborted) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        this.wake = null;
        resolve();
      };
      const timer = setTimeout(() => {
        for (const runId of this.watched) this.pending.add(runId);
        done();
      }, timeoutMs);
      signal.addEventListener('abort', done, { once: true });
      this.wake = done;
    });
  }

  private readonly mark = (runId: string): void => {
    this.pending.add(runId);
    this.wake?.();
  };
}

export class RunEventHub {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly frames = new Map<string, string>();
  private cachedChars = 0;

  notify(runId: string): void {
    for (const listener of [...(this.listeners.get(runId) ?? [])]) listener(runId);
  }

  watch(runIds: Iterable<string>): RunWatch {
    return new RunWatch(this, runIds);
  }

  listen(runId: string, listener: Listener): void {
    const listening = this.listeners.get(runId) ?? new Set<Listener>();
    this.listeners.set(runId, listening);
    listening.add(listener);
  }

  unlisten(runId: string, listener: Listener): void {
    const listening = this.listeners.get(runId);
    if (!listening) return;
    listening.delete(listener);
    if (listening.size === 0) this.listeners.delete(runId);
  }

  frame(runId: string, stored: StoredRunEvent): string {
    const key = `${runId}:${stored.seq}`;
    const cached = this.frames.get(key);
    if (cached !== undefined) return cached;
    const frame = eventFrame(runId, stored);
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
}
