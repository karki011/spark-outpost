import { SLOW_CHECK_SECONDS } from '../tasks/commands.ts';
import {
  notObserved,
  result,
  type CheckResult,
  type CommandTiming,
  type OutputEvent,
} from '../rows/types.ts';

export const LIVE_MIN_EVENTS = 60;
export const LIVE_FIRST_WITHIN_MS = 3_000;
export const LONG_COMMAND_MS = SLOW_CHECK_SECONDS * 1_000;
export const LONG_QUIET_GAP_MS = 60_000;
export const NO_TICKER = 'no ticker command was recorded';
export const NO_LONG_COMMAND = 'no check command was recorded';

export function wasObserved(check: CheckResult): boolean {
  return !check.notObserved && check.detail !== NO_TICKER && check.detail !== NO_LONG_COMMAND;
}

export function longest(commands: readonly CommandTiming[], pattern: RegExp): CommandTiming | null {
  const length = (command: CommandTiming) =>
    (command.finishedAt ?? command.startedAt) - command.startedAt;
  const matching = commands.filter((command) => pattern.test(command.command));
  return matching.sort((a, b) => length(b) - length(a))[0] ?? null;
}

function during(command: CommandTiming, events: readonly OutputEvent[]): number[] {
  const end = command.finishedAt ?? Number.POSITIVE_INFINITY;
  return events
    .filter((event) => event.commandId === command.id && event.at <= end)
    .map((event) => event.at)
    .sort((a, b) => a - b);
}

export function liveOutputCheck(
  command: CommandTiming | null,
  events: readonly OutputEvent[],
): CheckResult {
  const name = 'Live output';
  if (!command) return notObserved(name, NO_TICKER);
  const times = during(command, events);
  const firstMs = times.length > 0 ? times[0]! - command.startedAt : null;
  const pass =
    command.finishedAt !== null &&
    times.length >= LIVE_MIN_EVENTS &&
    firstMs !== null &&
    firstMs <= LIVE_FIRST_WITHIN_MS;
  const detail = `${times.length} output events before the command ended; first after ${firstMs ?? 'no'} ms`;
  return result(name, pass, detail, { events: times.length, firstEventMs: firstMs });
}

function widestGap(command: CommandTiming, times: readonly number[]): number {
  const points = [command.startedAt, ...times, command.finishedAt ?? command.startedAt];
  return points.slice(1).reduce((widest, at, index) => Math.max(widest, at - points[index]!), 0);
}

export function longCommandCheck(
  command: CommandTiming | null,
  events: readonly OutputEvent[],
  wantedMs: number = LONG_COMMAND_MS,
): CheckResult {
  const name = 'Long command';
  if (!command) return notObserved(name, NO_LONG_COMMAND);
  if (command.finishedAt === null) return result(name, false, 'the command never finished');
  const ranMs = command.finishedAt - command.startedAt;
  const times = during(command, events);
  const gapMs = widestGap(command, times);
  const pass = ranMs >= wantedMs && times.length > 0 && gapMs <= LONG_QUIET_GAP_MS;
  const detail = `ran ${Math.round(ranMs / 1000)} s inside the turn; ${times.length} output events; widest quiet gap ${Math.round(gapMs / 1000)} s`;
  return result(name, pass, detail, { ranMs, events: times.length, widestGapMs: gapMs });
}
