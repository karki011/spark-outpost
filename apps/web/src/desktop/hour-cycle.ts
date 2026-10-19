import { localeHourCycle, type HourCycle } from '../calendar/clock-format.ts';
import { sparkDesktop } from './desktop-bridge.ts';

const LOCALE_CYCLE = localeHourCycle();
let fromMac: HourCycle | null | undefined;

function parseCycle(value: unknown): HourCycle | null {
  return value === 'h12' || value === 'h23' ? value : null;
}

export function hourCycle(): HourCycle {
  const clock = sparkDesktop()?.clock;
  if (clock && fromMac === undefined) {
    fromMac = parseCycle(clock.hourCycle);
    clock.onHourCycle((value) => {
      fromMac = parseCycle(value);
    });
  }
  return fromMac ?? LOCALE_CYCLE;
}
