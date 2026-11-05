import { auditFacts } from '../runner/collect.ts';
import type { TurnDriver } from '../runner/driver.ts';
import type { RunRecord } from '../runner/results.ts';
import { reviewMarks } from '../rows/review-marks.ts';
import { commandRows, outputEvents, protocolRows } from '../rows/rows.ts';
import type { CheckResult } from '../rows/types.ts';
import { liveOutputCheck, longCommandCheck, longest } from './command-output.ts';
import { gateMatchCheck, gatedToolCalls } from './gate-match.ts';

export const TICKER_COMMAND = /ticker/;
export const SLOW_CHECK_COMMAND = /slow-check|check:slow/;
const TICKER_TASK = '6';
const SLOW_CHECK_TASK = '7';

export type SeenRun = Pick<RunRecord, 'taskId' | 'runIds'>;

function runIdsOf(records: readonly SeenRun[], taskId?: string): string[] {
  return records
    .filter((record) => taskId === undefined || record.taskId === taskId)
    .flatMap((record) => record.runIds);
}

async function gate(driver: TurnDriver, runIds: string[]): Promise<CheckResult> {
  const rows = await protocolRows(driver.db, runIds);
  const audit = await auditFacts(driver.db, runIds);
  return gateMatchCheck(gatedToolCalls(rows), audit.approvals, reviewMarks(rows));
}

async function commandCheck(
  driver: TurnDriver,
  runIds: string[],
  pattern: RegExp,
  check: typeof liveOutputCheck,
): Promise<CheckResult> {
  const command = longest(await commandRows(driver.db, runIds), pattern);
  return check(command, await outputEvents(driver.db, runIds));
}

export async function sessionChecks(
  driver: TurnDriver,
  records: readonly SeenRun[],
): Promise<CheckResult[]> {
  const all = runIdsOf(records);
  if (all.length === 0) return [];
  const results = [await gate(driver, all)];
  const ticker = runIdsOf(records, TICKER_TASK);
  if (ticker.length > 0) {
    results.push(await commandCheck(driver, ticker, TICKER_COMMAND, liveOutputCheck));
  }
  const slow = runIdsOf(records, SLOW_CHECK_TASK);
  if (slow.length > 0) {
    results.push(await commandCheck(driver, slow, SLOW_CHECK_COMMAND, longCommandCheck));
  }
  return results;
}
