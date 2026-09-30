import type { AnalyticsWindow } from '@spark-outpost/contracts';
import { addDays, localDate, resolveWindow } from '../../analytics/window.ts';
import { localTimeZone, nowOf, type SparkToolDeps } from '../deps.ts';
import { SparkToolError } from '../tool.ts';

export function lastDays(deps: SparkToolDeps, days: number): AnalyticsWindow {
  const timeZone = localTimeZone(deps);
  const now = nowOf(deps);
  const to = localDate(now, timeZone);
  const window = resolveWindow({ range: 'custom', from: addDays(to, 1 - days), to }, timeZone, now);
  if (!window) throw new SparkToolError('Pick between 1 and 366 days.');
  return window;
}
