import { realpath } from 'node:fs/promises';
import type { CheckBaseline, CheckResult, CheckScope } from '@spark-outpost/contracts';
import { attributeFailure } from '../checks/attribution.ts';
import { Baselines, type BaseResult } from '../checks/baseline.ts';
import { changeFacts } from '../checks/change-facts.ts';
import type { CheckCommand, ProjectFiles } from '../checks/detect.ts';
import {
  SAME_SETUP_PROBLEM,
  environmentAdvice,
  environmentProblem,
  outputShape,
  unusableScopedForm,
  type EnvironmentProblem,
} from '../checks/failures.ts';
import { readProjectFiles } from '../checks/project-checks.ts';
import type { CheckRun } from '../checks/run-check.ts';
import { scopedCheck, scopedSuggestion } from '../checks/scope.ts';
import { chatWorktreeAt } from '../persistence/chat-worktrees.ts';
import { checkMemory } from './check-results.ts';
import { runBase } from './member-prompts.ts';
import type { Session } from './session.ts';

export const UNFINISHED_NOTE =
  'It could not finish in time earlier in this turn, so it was not run again.';

export interface PlannedCheck {
  check: CheckCommand;
  scope: CheckScope | null;
  whole: CheckCommand | null;
}

export interface Round {
  planned: PlannedCheck[];
  baselines: Baselines | null;
  files: ProjectFiles | null;
  changed: readonly string[];
  advised: Set<EnvironmentProblem>;
  roots: string[];
  stale: string | null;
  limitMs: number;
}

interface RoundOptions {
  commands: readonly CheckCommand[];
  scope: boolean;
  stale: string | null;
  limitMs: number;
  env?: Readonly<Record<string, string>>;
}

type Attributed = Omit<CheckResult, 'approvalId'>;

async function lookUpBase(s: Session): Promise<string | null> {
  const root = s.input.projectRoots[0];
  if (s.input.chatWorktree && root) {
    const record = await chatWorktreeAt(s.deps.db, root);
    if (record?.baseCommit) return record.baseCommit;
  }
  return (await runBase(s))?.ref ?? null;
}

async function checkBase(s: Session): Promise<string | null> {
  const memory = checkMemory(s);
  if (memory.base === undefined) memory.base = s.git ? await lookUpBase(s).catch(() => null) : null;
  return memory.base;
}

const whole = (check: CheckCommand): PlannedCheck => ({ check, scope: null, whole: null });

export async function openRound(s: Session, cwd: string, options: RoundOptions): Promise<Round> {
  const base = await checkBase(s);
  const files = await readProjectFiles(cwd).catch(() => null);
  const facts = base && files ? await changeFacts(cwd, base, files).catch(() => null) : null;
  const planned = options.commands.map((check) => {
    const scoped = facts && options.scope ? scopedCheck(check, facts) : null;
    return scoped ? { ...scoped, whole: check } : whole(check);
  });
  const baselines = base
    ? new Baselines({
        db: s.deps.db,
        cwd,
        base,
        signal: s.control.signal,
        limitMs: options.limitMs,
        ...(options.env ? { env: options.env } : {}),
      })
    : null;
  const roots = [cwd, await realpath(cwd).catch(() => cwd)];
  return {
    planned,
    baselines,
    files: options.scope ? files : null,
    changed: facts?.changed ?? [],
    advised: new Set(),
    roots,
    stale: options.stale,
    limitMs: options.limitMs,
  };
}

export async function closeRound(round: Round): Promise<void> {
  await round.baselines?.dispose().catch(() => undefined);
}

export function staleResult(check: CheckCommand, note: string): CheckResult {
  return {
    command: check.command,
    kind: check.kind,
    outcome: 'failed',
    exitCode: null,
    durationMs: 0,
    outputTail: '',
    truncated: false,
    note,
    approvalId: null,
    cause: 'environment',
  };
}

function minutes(ms: number): string {
  const value = ms / 60_000;
  return value >= 1 ? `${Math.round(value)} min` : `${Math.round(ms / 1000)} s`;
}

function timeoutNote(planned: PlannedCheck, round: Round): string {
  const lead = `It could not finish in ${minutes(round.limitMs)} and was stopped. That is not counted against this change.`;
  const narrower =
    planned.scope || !round.files ? null : scopedSuggestion(planned.check, round.files);
  if (narrower) {
    return `${lead} A narrower command such as \`${narrower}\` can be set in Settings > Projects.`;
  }
  return `${lead} A narrower check command can be set in Settings > Projects.`;
}

function baselineShown(
  base: BaseResult,
  verdict: { shared: string[]; added: string[] },
): CheckBaseline {
  return {
    base: base.base,
    outcome: base.outcome,
    cached: base.cached,
    trusted: base.trusted,
    durationMs: base.durationMs,
    shared: verdict.shared,
    added: base.outcome === 'failed' ? verdict.added : [],
  };
}

export async function attributed(
  planned: PlannedCheck,
  run: CheckRun,
  round: Round,
): Promise<Attributed | 'retry_whole' | null> {
  const { check, scope } = planned;
  const shown: Attributed = {
    command: check.command,
    kind: check.kind,
    outcome: 'failed',
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    outputTail: run.outputTail,
    truncated: run.truncated,
    note: null,
    ...(scope ? { scope } : {}),
  };
  if (run.timedOut) {
    return { ...shown, outcome: 'timed_out', cause: 'timeout', note: timeoutNote(planned, round) };
  }
  if (run.exitCode === 0) return { ...shown, outcome: 'passed' };
  const finished = {
    argv: check.argv,
    exitCode: run.exitCode,
    outputTail: run.outputTail,
    setup: run.setup ?? null,
  };
  if (scope && unusableScopedForm(finished)) return 'retry_whole';
  const problem = environmentProblem(finished);
  if (problem) {
    const note = round.advised.has(problem)
      ? SAME_SETUP_PROBLEM
      : environmentAdvice(problem, finished);
    round.advised.add(problem);
    return { ...shown, cause: 'environment', note };
  }
  const output = {
    failures: run.failures,
    shape: outputShape(run.outputTail, round.roots),
    output: run.outputTail,
  };
  const base = round.baselines
    ? await round.baselines.evidence({ check, durationMs: run.durationMs })
    : null;
  if (round.baselines && !base) return null;
  const verdict = attributeFailure(output, round.changed, base);
  return {
    ...shown,
    failures: run.failures,
    cause: verdict.cause,
    blamed: verdict.blamed,
    ...(base ? { baseline: baselineShown(base, verdict) } : {}),
  };
}
