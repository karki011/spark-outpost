const IDLE_TIMEOUT_MS = 4_000;
const FALLBACK_DELAY_MS = 1_500;

export function whenIdle(work: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(work, { timeout: IDLE_TIMEOUT_MS });
    return () => cancelIdleCallback(handle);
  }
  const timer = setTimeout(work, FALLBACK_DELAY_MS);
  return () => clearTimeout(timer);
}

export function oneAtATimeWhenIdle(
  tasks: readonly (() => unknown)[],
  startAfterMs = 0,
): () => void {
  let cancel: () => void = () => undefined;
  let next = 0;
  const run = () => {
    const task = tasks[next];
    next += 1;
    if (!task) return;
    void Promise.resolve()
      .then(task)
      .catch(() => undefined)
      .then(() => {
        cancel = whenIdle(run);
      });
  };
  const start = setTimeout(() => {
    cancel = whenIdle(run);
  }, startAfterMs);
  return () => {
    next = tasks.length;
    clearTimeout(start);
    cancel();
  };
}
