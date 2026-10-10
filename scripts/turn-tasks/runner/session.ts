import { wasObserved } from '../checks/command-output.ts';
import { sessionChecks } from '../checks/session-checks.ts';
import type { CheckResult } from '../rows/types.ts';
import type { ModeChoice, Task } from '../tasks/types.ts';
import type { TurnDriver } from './driver.ts';
import { writeChecks, type RunRecord } from './results.ts';
import { runTask } from './run-task.ts';
import { recordLine } from './summary.ts';

export interface SessionPlan {
  label: string;
  runs: number;
  live: boolean;
  keep: boolean;
  tasks: readonly Task[];
  mode: ModeChoice | null;
}

export interface SessionIo {
  log: (line: string) => void;
  stopping: () => boolean;
  outputRoot?: string;
  scratchBase?: string;
}

export function checkLine(check: CheckResult): string {
  const failed = wasObserved(check) ? 'FAIL' : 'none';
  return `${check.pass ? 'pass' : failed}  ${check.name}: ${check.detail}`;
}

function modesFor(task: Task, mode: ModeChoice | null): ModeChoice[] {
  if (mode === null) return [...task.modes];
  return task.modes.includes(mode) ? [mode] : [];
}

async function runTasks(driver: TurnDriver, plan: SessionPlan, io: SessionIo) {
  const records: RunRecord[] = [];
  let cancelled = false;
  const cancelWhenStopping = async ({ runId }: { runId: string }) => {
    if (!io.stopping() || cancelled) return;
    cancelled = true;
    await driver.cancel(runId);
  };
  for (const task of plan.tasks) {
    for (const mode of modesFor(task, plan.mode)) {
      if (io.stopping()) return records;
      const done = await runTask(driver, task, mode, {
        label: plan.label,
        runs: plan.runs,
        live: plan.live,
        keepCopies: plan.keep,
        hooks: { eachPoll: cancelWhenStopping },
        onRecord: (record, file) => io.log(`${recordLine(record)}\n  ${file}`),
        ...(io.outputRoot ? { outputRoot: io.outputRoot } : {}),
        ...(io.scratchBase ? { scratchBase: io.scratchBase } : {}),
      });
      records.push(...done);
    }
  }
  return records;
}

export async function runSession(
  driver: TurnDriver,
  plan: SessionPlan,
  io: SessionIo,
  check: typeof sessionChecks = sessionChecks,
): Promise<CheckResult[]> {
  const records = await runTasks(driver, plan, io);
  const checks = await check(driver, records);
  for (const result of checks) io.log(checkLine(result));
  if (checks.length === 0) return checks;
  const file = await writeChecks(
    plan.label,
    { provider: driver.provider, live: plan.live, at: new Date().toISOString(), results: checks },
    io.outputRoot,
  );
  io.log(`Checks: ${file}`);
  return checks;
}
