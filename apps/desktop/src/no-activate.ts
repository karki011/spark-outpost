import { createRequire } from 'node:module';

export interface NativeWindow {
  isDestroyed(): boolean;
  getNativeWindowHandle(): Buffer;
}

export type PreventActivation = (window: NativeWindow) => void;

interface NoActivateAddon {
  preventActivation(handle: Buffer): unknown;
}

type LoadAddon = (addonPath: string) => unknown;

const requireAddon: LoadAddon = (addonPath) => createRequire(import.meta.url)(addonPath);

function isAddon(value: unknown): value is NoActivateAddon {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as NoActivateAddon).preventActivation === 'function'
  );
}

function readAddon(addonPath: string, load: LoadAddon): NoActivateAddon | string {
  try {
    const loaded = load(addonPath);
    return isAddon(loaded) ? loaded : 'it has no preventActivation';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function noActivate(
  addonPath: string,
  log: (line: string) => void,
  load: LoadAddon = requireAddon,
): PreventActivation {
  const addon = readAddon(addonPath, load);
  if (typeof addon === 'string') {
    log(
      `Clicks on Spark Island and meeting cards will bring Spark forward: the no-activate addon at ${addonPath} did not load (${addon}). Run pnpm desktop:no-activate.`,
    );
    return () => undefined;
  }
  let warned = false;
  return (window) => {
    if (window.isDestroyed()) return;
    const result = addon.preventActivation(window.getNativeWindowHandle());
    if (result === 'applied' || warned) return;
    warned = true;
    log(`Clicks on Spark Island and meeting cards will bring Spark forward: ${String(result)}.`);
  };
}
