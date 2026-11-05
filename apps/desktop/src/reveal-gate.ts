export interface RevealTimers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface RevealGate {
  ready(): void;
  cancel(): void;
  revealed(): boolean;
}

const realTimers: RevealTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function revealGate(
  show: () => void,
  fallbackMs: number,
  timers: RevealTimers = realTimers,
): RevealGate {
  let state: 'waiting' | 'shown' | 'cancelled' = 'waiting';
  const reveal = () => {
    if (state !== 'waiting') return;
    state = 'shown';
    timers.clear(fallback);
    show();
  };
  const fallback = timers.set(reveal, fallbackMs);
  return {
    ready: reveal,
    cancel: () => {
      if (state !== 'waiting') return;
      state = 'cancelled';
      timers.clear(fallback);
    },
    revealed: () => state === 'shown',
  };
}
