import type { Cdp } from './cdp.ts';

export interface SettleTiming {
  settleMs: number;
  loadMs: number;
  restMs: number;
}

const STARTS = new Set([
  'Page.frameStartedLoading',
  'Page.frameRequestedNavigation',
  'Page.frameNavigated',
]);
const ENDS = new Set(['Page.loadEventFired', 'Page.navigatedWithinDocument']);

export function pageSettles(cdp: Cdp, timing: SettleTiming, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let loading = false;
    let stop: () => void = () => undefined;
    const timers: NodeJS.Timeout[] = [];
    const finish = () => {
      for (const timer of timers) clearTimeout(timer);
      stop();
      signal.removeEventListener('abort', finish);
      resolve();
    };
    stop = cdp.listen((method) => {
      if (STARTS.has(method)) loading = true;
      if (ENDS.has(method)) timers.push(setTimeout(finish, timing.restMs));
    });
    timers.push(
      setTimeout(() => {
        if (!loading) finish();
      }, timing.settleMs),
      setTimeout(finish, timing.loadMs),
    );
    signal.addEventListener('abort', finish, { once: true });
  });
}
