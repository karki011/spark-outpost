import { performance } from 'node:perf_hooks';
import type { LogFile } from './report.ts';

export const LAG_WARN_MS = 200;
export const LAG_MARKER = 'Event loop blocked';
const TICK_MS = 500;
const SHOWN_LABELS = 5;
const KEPT_WARNINGS = 50;

export class ActiveWork {
  private readonly current = new Map<number, string>();
  private readonly recent = new Set<string>();
  private nextId = 0;

  begin(label: string): () => void {
    const id = this.nextId++;
    this.current.set(id, label);
    this.recent.add(label);
    return () => {
      this.current.delete(id);
    };
  }

  takeRecent(): string[] {
    const seen = new Set([...this.recent, ...this.current.values()]);
    this.recent.clear();
    return [...seen];
  }
}

export function lagWarning(
  processName: string,
  lagMs: number,
  active: readonly string[],
  thresholdMs = LAG_WARN_MS,
): string | null {
  if (lagMs <= thresholdMs) return null;
  const shown = active.slice(0, SHOWN_LABELS);
  const more = active.length - shown.length;
  const during =
    shown.length === 0
      ? 'with no request or job running'
      : `during ${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
  return `${LAG_MARKER} for ${Math.round(lagMs)} ms in the ${processName} ${during}`;
}

export interface LagMonitorOptions {
  processName: string;
  work: ActiveWork;
  log?: (line: string) => void;
  tickMs?: number;
  now?: () => number;
}

export function startLagMonitor(options: LagMonitorOptions): () => void {
  const tickMs = options.tickMs ?? TICK_MS;
  const now = options.now ?? (() => performance.now());
  const log = options.log ?? ((line: string) => console.warn(line));
  let last = now();
  const timer = setInterval(() => {
    const at = now();
    const warning = lagWarning(options.processName, at - last - tickMs, options.work.takeRecent());
    last = at;
    if (warning) log(warning);
  }, tickMs);
  timer.unref();
  return () => clearInterval(timer);
}

export function recentLagWarnings(logs: readonly LogFile[], limit = KEPT_WARNINGS): string[] {
  const lines = logs.flatMap((log) =>
    log.text.split('\n').filter((line) => line.includes(LAG_MARKER)),
  );
  return lines.sort().slice(-limit);
}
