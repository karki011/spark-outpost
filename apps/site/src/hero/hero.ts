import { reducedMotion } from '../motion.ts';

function webglAvailable(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

function whenIdle(task: () => void): void {
  if ('requestIdleCallback' in window) window.requestIdleCallback(task, { timeout: 1200 });
  else setTimeout(task, 200);
}

export function setUpHero(): void {
  const stage = document.querySelector<HTMLElement>('[data-scout-stage]');
  const poke = document.querySelector<HTMLButtonElement>('[data-scout-poke]');
  if (!stage || !poke) return;
  if (reducedMotion() || !webglAvailable()) return;
  whenIdle(async () => {
    try {
      await document.fonts.load('600 36px "Geist Variable"').catch(() => []);
      const { startScoutScene } = await import('./scout-scene.ts');
      await startScoutScene(stage, poke);
      stage.dataset.live = 'true';
      poke.hidden = false;
    } catch {
      stage.querySelector('canvas')?.remove();
    }
  });
}
