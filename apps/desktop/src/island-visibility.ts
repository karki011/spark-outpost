export interface VisibilityTimers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface VisibilityActions {
  show(): void;
  hide(): void;
}

export interface IslandVisibility {
  sparkFocus(focused: boolean): void;
  summon(): void;
  hidden(): boolean;
  cancel(): void;
}

const realTimers: VisibilityTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const FOCUS_SETTLE_MS = 180;

export function islandVisibility(
  actions: VisibilityActions,
  settleMs = FOCUS_SETTLE_MS,
  timers: VisibilityTimers = realTimers,
): IslandVisibility {
  let hidden = false;
  let wanted = false;
  let pending: unknown = null;

  const settle = () => {
    pending = null;
    if (wanted === hidden) return;
    hidden = wanted;
    if (hidden) actions.hide();
    else actions.show();
  };

  const clear = () => {
    if (pending !== null) timers.clear(pending);
    pending = null;
  };

  return {
    sparkFocus(focused) {
      wanted = focused;
      clear();
      if (wanted !== hidden) pending = timers.set(settle, settleMs);
    },
    summon() {
      clear();
      wanted = false;
      if (!hidden) return;
      hidden = false;
      actions.show();
    },
    hidden: () => hidden,
    cancel: clear,
  };
}
