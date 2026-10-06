interface StallWatch {
  touch(): void;
  stalled(): boolean;
  stop(): void;
}

const IDLE: StallWatch = { touch: () => undefined, stalled: () => false, stop: () => undefined };

export function stallText(name: string, ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `${name} made no progress for ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

export function createStallWatch(ms: number | null, onStall: () => void): StallWatch {
  if (ms === null) return IDLE;
  let stalled = false;
  let timer: NodeJS.Timeout | null = null;
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      onStall();
    }, ms);
    timer.unref();
  };
  arm();
  return {
    touch: () => {
      if (!stalled) arm();
    },
    stalled: () => stalled,
    stop: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
