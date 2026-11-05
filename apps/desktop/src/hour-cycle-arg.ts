export type HourCycle = 'h12' | 'h23';

const HOUR_CYCLE_ARG = '--spark-hour-cycle=';
const FORCE_24 = 'AppleICUForce24HourTime';
const FORCE_12 = 'AppleICUForce12HourTime';

export function macHourCycle(read: (key: string) => boolean): HourCycle | null {
  if (read(FORCE_24)) return 'h23';
  if (read(FORCE_12)) return 'h12';
  return null;
}

export function isHourCycle(value: unknown): value is HourCycle {
  return value === 'h12' || value === 'h23';
}

export function hourCycleArgs(cycle: HourCycle | null): string[] {
  return cycle ? [`${HOUR_CYCLE_ARG}${cycle}`] : [];
}

export function hourCycleFromArgs(argv: readonly string[]): HourCycle | null {
  const value = argv.find((arg) => arg.startsWith(HOUR_CYCLE_ARG))?.slice(HOUR_CYCLE_ARG.length);
  return isHourCycle(value) ? value : null;
}
