export const FLOW_HIGH_BYTES = 1024 * 1024;
export const FLOW_LOW_BYTES = 256 * 1024;
export const FLOW_REDRAW_MAX_BYTES = (FLOW_HIGH_BYTES - FLOW_LOW_BYTES) / 2;
export const FLOW_CHECK_MS = 100;
export const FLOW_STALL_MS = 15_000;

interface FlowSource {
  pause(): void;
  resume(): void;
}

export interface OutputFlow {
  sent(bytes: number): void;
  acked(bytes: number): void;
  stop(): void;
}

export function createOutputFlow(
  source: FlowSource,
  buffered: () => number,
  now: () => number = Date.now,
): OutputFlow {
  let sent = 0;
  let acked = 0;
  let acking = false;
  let paused = false;
  let progressAt = 0;
  let timer: NodeJS.Timeout | null = null;

  const waiting = () => (acking ? sent - acked : 0);
  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const resume = () => {
    paused = false;
    stopTimer();
    source.resume();
  };
  const check = () => {
    if (!paused) {
      if (waiting() <= FLOW_HIGH_BYTES && buffered() <= FLOW_HIGH_BYTES) return;
      paused = true;
      progressAt = now();
      source.pause();
      timer = setInterval(check, FLOW_CHECK_MS);
      timer.unref();
      return;
    }
    if (now() - progressAt >= FLOW_STALL_MS) {
      acking = false;
      acked = sent;
    }
    if (waiting() < FLOW_LOW_BYTES && buffered() < FLOW_LOW_BYTES) resume();
  };

  return {
    sent(bytes) {
      sent += bytes;
      check();
    },
    acked(bytes) {
      acking = true;
      acked = Math.min(sent, acked + bytes);
      progressAt = now();
      check();
    },
    stop() {
      stopTimer();
      if (paused) {
        paused = false;
        source.resume();
      }
    },
  };
}
