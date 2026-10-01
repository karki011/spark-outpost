import type { Emit, UpdateDriver } from './update-controller.ts';

export type PreviewPhase = 'available' | 'ready';

export const PREVIEW_VERSION = '9.9.9-preview';
const STEP_MS = 250;
const STEPS = 12;

export function previewPhase(value: string | undefined): PreviewPhase | null {
  return value === 'available' || value === 'ready' ? value : null;
}

export function previewDriver(emit: Emit, quit: () => void): UpdateDriver {
  return {
    configure: () => undefined,
    check: async () => PREVIEW_VERSION,
    download: async () => {
      for (let step = 1; step <= STEPS; step += 1) {
        await new Promise((resolve) => setTimeout(resolve, STEP_MS));
        emit({ type: 'progress', percent: (step / STEPS) * 100 });
      }
      emit({ type: 'downloaded', version: PREVIEW_VERSION });
    },
    install: (relaunch) => {
      if (!relaunch) quit();
    },
  };
}
