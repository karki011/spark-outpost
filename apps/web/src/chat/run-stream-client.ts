import {
  RUN_STREAM_MAX_RUNS,
  RUN_STREAM_PATH,
  parseRunStreamFrame,
  runCursorsParam,
  type RunEvent,
  type RunStreamFrame,
} from '@spark-outpost/contracts';

const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 15_000;

export interface RunListener {
  event(seq: number, event: RunEvent): void;
}

export type RunEffect = (conversationId: string, event: RunEvent) => void;

interface Watcher {
  listener: RunListener;
  cursor: number;
  done: boolean;
}

interface Watched {
  conversationId: string;
  watchers: Set<Watcher>;
  applied: number;
}

type Timer = ReturnType<typeof setTimeout>;

export class RunStreamClient {
  private readonly runs = new Map<string, Watched>();
  private readonly carried = new Map<string, number>();
  private source: EventSource | null = null;
  private planned = false;
  private retry: Timer | undefined;
  private attempts = 0;

  constructor(private readonly effect: RunEffect) {}

  subscribe(runId: string, conversationId: string, listener: RunListener): () => void {
    const watched = this.runs.get(runId) ?? {
      conversationId,
      watchers: new Set<Watcher>(),
      applied: 0,
    };
    this.runs.set(runId, watched);
    const watcher: Watcher = { listener, cursor: 0, done: false };
    watched.watchers.add(watcher);
    this.plan();
    return () => {
      watched.watchers.delete(watcher);
      if (watched.watchers.size === 0 && this.runs.get(runId) === watched) this.runs.delete(runId);
      this.plan();
    };
  }

  private plan(): void {
    if (this.planned) return;
    this.planned = true;
    queueMicrotask(() => {
      this.planned = false;
      this.sync();
    });
  }

  private wanted(): Map<string, number> {
    const cursors = new Map<string, number>();
    for (const [runId, watched] of this.runs) {
      const open = [...watched.watchers].filter((watcher) => !watcher.done);
      if (open.length === 0) continue;
      cursors.set(runId, Math.min(...open.map((watcher) => watcher.cursor)));
      if (cursors.size === RUN_STREAM_MAX_RUNS) break;
    }
    return cursors;
  }

  private carries(wanted: Map<string, number>): boolean {
    if (!this.source) return false;
    for (const [runId, cursor] of wanted) {
      const carried = this.carried.get(runId);
      if (carried === undefined || cursor < carried) return false;
    }
    return true;
  }

  private sync(): void {
    const wanted = this.wanted();
    if (wanted.size === 0) {
      this.close();
      return;
    }
    if (this.retry !== undefined || this.carries(wanted)) return;
    this.connect(wanted);
  }

  private connect(cursors: Map<string, number>): void {
    this.close();
    const source = new EventSource(`${RUN_STREAM_PATH}?runs=${runCursorsParam(cursors)}`);
    this.source = source;
    for (const [runId, cursor] of cursors) this.carried.set(runId, cursor);
    source.onmessage = (message: MessageEvent<string>) => {
      if (this.source !== source) return;
      this.attempts = 0;
      const frame = parseRunStreamFrame(message.data);
      if (frame) this.receive(frame);
    };
    source.onerror = () => {
      if (this.source !== source) return;
      this.close();
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    if (this.wanted().size === 0) return;
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.attempts);
    this.attempts += 1;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.sync();
    }, delay);
  }

  private close(): void {
    this.source?.close();
    this.source = null;
    this.carried.clear();
    clearTimeout(this.retry);
    this.retry = undefined;
  }

  private receive(frame: RunStreamFrame): void {
    if ('end' in frame) {
      this.end(frame.runId);
      return;
    }
    const { runId, seq, event } = frame;
    const carried = this.carried.get(runId);
    if (carried === undefined || seq <= carried) return;
    this.carried.set(runId, seq);
    const watched = this.runs.get(runId);
    if (!watched) return;
    if (seq > watched.applied) {
      watched.applied = seq;
      this.effect(watched.conversationId, event);
    }
    for (const watcher of watched.watchers) {
      if (seq <= watcher.cursor) continue;
      watcher.cursor = seq;
      watcher.listener.event(seq, event);
    }
  }

  private end(runId: string): void {
    const carried = this.carried.get(runId);
    if (carried === undefined) return;
    this.carried.delete(runId);
    for (const watcher of this.runs.get(runId)?.watchers ?? []) {
      if (watcher.cursor >= carried) watcher.done = true;
    }
    this.plan();
  }
}
