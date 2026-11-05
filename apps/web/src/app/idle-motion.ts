export type MotionMode = 'live' | 'rest' | 'paused';

const REST_AFTER_MS = 4_000;
const PULSE_EVERY_MS = 12_000;
const PULSE_MS = 1_000;
const INPUTS = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const;

export function setMotionMode(mode: MotionMode, root: HTMLElement = document.documentElement) {
  if (root.dataset.motion !== mode) root.dataset.motion = mode;
}

export function startIdleMotion(root: HTMLElement = document.documentElement): () => void {
  let focused = !document.hidden;
  let lastInput = performance.now();
  let pulseUntil = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const apply = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!focused || document.hidden) {
      setMotionMode('paused', root);
      return;
    }
    const now = performance.now();
    const restAt = lastInput + REST_AFTER_MS;
    if (now < restAt || now < pulseUntil) {
      setMotionMode('live', root);
      timer = setTimeout(apply, Math.max(restAt, pulseUntil) - now + 1);
      return;
    }
    setMotionMode('rest', root);
    timer = setTimeout(() => {
      pulseUntil = performance.now() + PULSE_MS;
      apply();
    }, PULSE_EVERY_MS);
  };

  const onInput = () => {
    const resting = root.dataset.motion !== 'live';
    lastInput = performance.now();
    if (resting) apply();
  };
  const onFocus = () => {
    focused = true;
    lastInput = performance.now();
    apply();
  };
  const onBlur = () => {
    focused = false;
    apply();
  };

  for (const type of INPUTS) window.addEventListener(type, onInput, { passive: true });
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', apply);
  apply();
  return () => {
    clearTimeout(timer);
    for (const type of INPUTS) window.removeEventListener(type, onInput);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', apply);
    delete root.dataset.motion;
  };
}
