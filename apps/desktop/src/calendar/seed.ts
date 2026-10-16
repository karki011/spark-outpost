import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

export const CALENDAR_SEED_ENV = 'SPARK_CALENDAR_SEED';
export const CALENDAR_SEED_STATE_ENV = 'SPARK_CALENDAR_SEED_STATE';

export interface CalendarSeedOptions {
  seedPath: string | null;
  env: NodeJS.ProcessEnv;
  log(line: string): void;
}

export type SeedPlan = { mode: 'seed' | 'remove'; binary: string; state: string } | null;

export function seedPlan(
  options: CalendarSeedOptions,
  exists: (file: string) => boolean,
): SeedPlan {
  const mode = options.env[CALENDAR_SEED_ENV];
  const state = options.env[CALENDAR_SEED_STATE_ENV];
  if (!options.seedPath || (mode !== 'seed' && mode !== 'remove') || !state) return null;
  if (!exists(options.seedPath)) return null;
  return { mode, binary: options.seedPath, state };
}

export function runCalendarSeed(options: CalendarSeedOptions): void {
  const plan = seedPlan(options, existsSync);
  if (!plan) return;
  options.log(`Running the calendar test seed (${plan.mode}).`);
  execFile(
    plan.binary,
    [plan.mode, '--state', plan.state],
    { env: {}, timeout: 60_000 },
    (error, stdout) => {
      const line = stdout.split('\n')[0]?.slice(0, 500) ?? '';
      options.log(`Calendar test seed (${plan.mode}): ${error ? 'failed' : 'done'} ${line}`);
    },
  );
}
