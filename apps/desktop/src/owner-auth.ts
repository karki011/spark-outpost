import { createRequire } from 'node:module';

export type OwnerAuthOutcome = 'ok' | 'cancelled' | 'unavailable' | 'failed';

export interface OwnerAuth {
  available(): boolean;
  authenticate(reason: string): Promise<OwnerAuthOutcome>;
}

interface OwnerAuthAddon {
  ownerAuthAvailable(): unknown;
  authenticateOwner(reason: string, done: (outcome: unknown) => void): unknown;
}

type LoadAddon = (addonPath: string) => unknown;

const OUTCOMES: readonly OwnerAuthOutcome[] = ['ok', 'cancelled', 'unavailable', 'failed'];
const STARTED = 'started';

const requireAddon: LoadAddon = (addonPath) => createRequire(import.meta.url)(addonPath);

function isAddon(value: unknown): value is OwnerAuthAddon {
  const addon = value as OwnerAuthAddon | null;
  return (
    typeof addon === 'object' &&
    addon !== null &&
    typeof addon.ownerAuthAvailable === 'function' &&
    typeof addon.authenticateOwner === 'function'
  );
}

function readAddon(addonPath: string, load: LoadAddon): OwnerAuthAddon | string {
  try {
    const loaded = load(addonPath);
    return isAddon(loaded) ? loaded : 'it has no owner authentication';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function outcomeOf(value: unknown): OwnerAuthOutcome {
  return OUTCOMES.find((outcome) => outcome === value) ?? 'failed';
}

const MISSING: OwnerAuth = {
  available: () => false,
  authenticate: async () => 'unavailable',
};

export function ownerAuth(
  addonPath: string,
  log: (line: string) => void,
  load: LoadAddon = requireAddon,
): OwnerAuth {
  const addon = readAddon(addonPath, load);
  if (typeof addon === 'string') {
    log(
      `Forgot code is unavailable: the addon at ${addonPath} did not load (${addon}). Run pnpm desktop:no-activate.`,
    );
    return MISSING;
  }
  return {
    available: () => {
      try {
        return addon.ownerAuthAvailable() === true;
      } catch {
        return false;
      }
    },
    authenticate: (reason) =>
      new Promise((resolve) => {
        try {
          const started = addon.authenticateOwner(reason, (outcome) => resolve(outcomeOf(outcome)));
          if (started !== STARTED) resolve('failed');
        } catch {
          resolve('failed');
        }
      }),
  };
}
