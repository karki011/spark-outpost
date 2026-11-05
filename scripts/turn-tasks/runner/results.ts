import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CheckResult } from '../rows/types.ts';
import { OUTPUT_ROOT } from '../paths.ts';
import type { Finding, ModeChoice, ProbeOutcome, TaskSet } from '../tasks/types.ts';
import type { Failure } from './failure.ts';
import type { Metrics } from './metrics.ts';
import type { Provider } from './providers.ts';
import type { AnsweredCard } from './run-turn.ts';
import type { RunTrace } from './trace.ts';

export interface RunRecord {
  label: string;
  provider: Provider;
  live: boolean;
  taskId: string;
  taskNumber: number;
  set: TaskSet;
  mode: ModeChoice;
  attempt: number;
  startedAt: string;
  runId: string | null;
  runIds: string[];
  baseCommit: string;
  pass: boolean;
  findings: Finding[];
  metrics: Metrics | null;
  answered: AnsweredCard[];
  error: string | null;
  failure: Failure | null;
  outcome?: ProbeOutcome;
  trace?: RunTrace;
}

export function resultsDir(label: string, root: string = OUTPUT_ROOT): string {
  if (!/^[\w.-]+$/.test(label)) throw new Error('A label holds letters, digits, dots and dashes.');
  return join(root, 'results', label);
}

export function recordName(record: RunRecord): string {
  return `${record.provider}-task-${record.taskId}-${record.mode}-${record.attempt}.json`;
}

export async function writeRecord(record: RunRecord, root?: string): Promise<string> {
  const dir = join(resultsDir(record.label, root), 'runs');
  await mkdir(dir, { recursive: true });
  const file = join(dir, recordName(record));
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

export async function readRecords(label: string, root?: string): Promise<RunRecord[]> {
  const dir = join(resultsDir(label, root), 'runs');
  const names = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.json'));
  const records: RunRecord[] = [];
  for (const name of names.sort()) {
    records.push(JSON.parse(await readFile(join(dir, name), 'utf8')) as RunRecord);
  }
  return records;
}

export interface CheckFile {
  provider: Provider;
  live: boolean;
  at: string;
  results: CheckResult[];
}

export async function writeChecks(label: string, file: CheckFile, root?: string): Promise<string> {
  const dir = join(resultsDir(label, root), 'checks');
  await mkdir(dir, { recursive: true });
  const target = join(dir, `${file.provider}-${file.at.replace(/[^0-9]/g, '')}.json`);
  await writeFile(target, `${JSON.stringify(file, null, 2)}\n`);
  return target;
}

export async function readChecks(label: string, root?: string): Promise<CheckFile[]> {
  const dir = join(resultsDir(label, root), 'checks');
  const names = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.json'));
  const files: CheckFile[] = [];
  for (const name of names.sort()) {
    files.push(JSON.parse(await readFile(join(dir, name), 'utf8')) as CheckFile);
  }
  return files;
}
