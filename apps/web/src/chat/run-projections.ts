import { isTerminalRunEvent, type RunEvent } from '@spark-outpost/contracts';
import { applyRunEvent, initialRunProjection, type RunProjection } from './run-projection.ts';
import type { RunListener } from './run-stream-client.ts';

export const KEPT_RUN_STREAMS = 6;

export interface RunStreamSource {
  subscribe(runId: string, conversationId: string, listener: RunListener): () => void;
}

interface Followed {
  projection: RunProjection;
  watchers: Set<() => void>;
  queued: [number, RunEvent][];
  frame: number;
  ended: boolean;
  stop: () => void;
}

type Schedule = (apply: () => void) => number;

export class RunProjections {
  private readonly runs = new Map<string, Followed>();

  constructor(
    private readonly source: RunStreamSource,
    private readonly keep = KEPT_RUN_STREAMS,
    private readonly schedule: Schedule = (apply) => requestAnimationFrame(apply),
    private readonly unschedule: (frame: number) => void = (frame) => cancelAnimationFrame(frame),
  ) {}

  read(runId: string): RunProjection {
    return this.runs.get(runId)?.projection ?? initialRunProjection;
  }

  watch(runId: string, conversationId: string, onChange: () => void): () => void {
    const run = this.runs.get(runId) ?? this.follow(runId, conversationId);
    this.runs.delete(runId);
    this.runs.set(runId, run);
    run.watchers.add(onChange);
    return () => {
      run.watchers.delete(onChange);
      if (this.runs.get(runId) !== run || run.watchers.size > 0) return;
      if (run.ended) this.drop(runId);
      else this.trim();
    };
  }

  warm(runId: string, conversationId: string): void {
    this.watch(runId, conversationId, () => undefined)();
  }

  private follow(runId: string, conversationId: string): Followed {
    const run: Followed = {
      projection: initialRunProjection,
      watchers: new Set(),
      queued: [],
      frame: 0,
      ended: false,
      stop: () => undefined,
    };
    const apply = () => {
      run.frame = 0;
      const events = run.queued;
      run.queued = [];
      for (const [seq, event] of events) run.projection = applyRunEvent(run.projection, seq, event);
      for (const watcher of run.watchers) watcher();
      if (run.ended && run.watchers.size === 0 && this.runs.get(runId) === run) this.drop(runId);
    };
    run.stop = this.source.subscribe(runId, conversationId, {
      event: (seq, event) => {
        run.queued.push([seq, event]);
        if (isTerminalRunEvent(event)) run.ended = true;
        if (run.ended || run.watchers.size === 0) {
          if (run.frame) this.unschedule(run.frame);
          apply();
          return;
        }
        run.frame ||= this.schedule(apply);
      },
    });
    return run;
  }

  private drop(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.runs.delete(runId);
    if (run.frame) this.unschedule(run.frame);
    run.stop();
  }

  private trim(): void {
    const idle = [...this.runs].filter(([, run]) => run.watchers.size === 0);
    for (const [runId] of idle.slice(0, Math.max(0, idle.length - this.keep))) this.drop(runId);
  }
}
