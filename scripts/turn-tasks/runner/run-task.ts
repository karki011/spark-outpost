import { homedir } from 'node:os';
import { freshCopy, removeCopy, type ScratchRepo } from '../scratch-repo/create.ts';
import type { ModeChoice, Task } from '../tasks/types.ts';
import { collectRun, type Collected } from './collect.ts';
import type { TurnDriver } from './driver.ts';
import { writeRecord, type RunRecord } from './results.ts';
import { runTurn, type TurnHooks } from './run-turn.ts';

export interface TaskRunOptions {
  label: string;
  runs: number;
  live: boolean;
  keepCopies?: boolean;
  scratchBase?: string;
  outputRoot?: string;
  home?: string;
  hooks?: TurnHooks;
  collect?: (driver: TurnDriver, runId: string, wallMs: number) => Promise<Collected>;
  onRecord?: (record: RunRecord, file: string) => void;
}

const defaultCollect = (driver: TurnDriver, runId: string, wallMs: number) =>
  collectRun(driver.db, runId, wallMs);

function emptyRecord(
  driver: TurnDriver,
  task: Task,
  mode: ModeChoice,
  attempt: number,
  options: TaskRunOptions,
  repo: ScratchRepo,
): RunRecord {
  return {
    label: options.label,
    provider: driver.provider,
    live: options.live,
    taskId: task.id,
    taskNumber: task.number,
    set: task.set,
    mode,
    attempt,
    startedAt: new Date().toISOString(),
    runId: null,
    runIds: [],
    baseCommit: repo.commit,
    pass: false,
    findings: [],
    metrics: null,
    answered: [],
    error: null,
    failure: null,
  };
}

async function attemptOnce(
  driver: TurnDriver,
  task: Task,
  mode: ModeChoice,
  record: RunRecord,
  repo: ScratchRepo,
  options: TaskRunOptions,
): Promise<void> {
  const chat = await driver.openChat(repo.path, driver.setupFor(mode));
  const policy = task.set === 'safety' ? 'deny' : 'work';
  const outcome = await runTurn(driver, chat, task.prompt, policy, options.hooks);
  record.runId = outcome.runId;
  record.answered = outcome.answered;
  const collected = await (options.collect ?? defaultCollect)(
    driver,
    outcome.runId,
    outcome.wallMs,
  );
  record.runIds = collected.runIds;
  record.metrics = collected.metrics;
  record.failure = collected.failure;
  if (collected.trace) record.trace = collected.trace;
  const verdict = await task.check({
    repo: repo.path,
    baseCommit: repo.commit,
    reply: collected.reply,
    toolchain: repo.toolchain,
    audit: collected.audit,
    home: options.home ?? homedir(),
  });
  record.pass = verdict.pass;
  record.findings = verdict.findings;
  if (verdict.outcome) record.outcome = verdict.outcome;
}

export async function runTask(
  driver: TurnDriver,
  task: Task,
  mode: ModeChoice,
  options: TaskRunOptions,
): Promise<RunRecord[]> {
  if (!task.modes.includes(mode)) throw new Error(`Task ${task.id} does not run in ${mode} mode.`);
  const records: RunRecord[] = [];
  for (let attempt = 1; attempt <= options.runs; attempt += 1) {
    const name = `${options.label}-${driver.provider}-${task.id}-${mode}-${attempt}`;
    const repo = await freshCopy(name, options.scratchBase);
    const record = emptyRecord(driver, task, mode, attempt, options, repo);
    try {
      await attemptOnce(driver, task, mode, record, repo, options);
    } catch (caught) {
      record.error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      if (!options.keepCopies) await removeCopy(repo);
    }
    const file = await writeRecord(record, options.outputRoot);
    options.onRecord?.(record, file);
    records.push(record);
  }
  return records;
}
