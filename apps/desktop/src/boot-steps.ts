import type { MigrationGuardEffects } from './update-migration.ts';

export type BootStep = 'waking' | 'database' | 'backup' | 'migrate' | 'spark';

export const BOOT_STATUS: Record<BootStep, string> = {
  waking: 'Waking up…',
  database: 'Starting the database…',
  backup: 'Backing up before the update…',
  migrate: 'Updating your data…',
  spark: 'Starting Spark…',
};

export const MIN_BOOT_MS = 3_000;

export function reportingSteps(
  effects: MigrationGuardEffects,
  report: (step: BootStep) => void,
): MigrationGuardEffects {
  return {
    ...effects,
    backup: (previousVersion) => {
      report('backup');
      return effects.backup(previousVersion);
    },
    migrate: () => {
      report('migrate');
      return effects.migrate();
    },
  };
}

export function leaveDelay(shownAt: number | null, now: number): number {
  if (shownAt === null) return 0;
  return Math.max(0, MIN_BOOT_MS - (now - shownAt));
}
