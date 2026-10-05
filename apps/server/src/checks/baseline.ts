import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CheckBaseline } from '@spark-outpost/contracts';
import {
  saveBaseline,
  savedBaseline,
  type BaselineKey,
  type BaselineRecord,
} from '../persistence/check-baselines.ts';
import type { Queryable } from '../persistence/db.ts';
import { git } from '../projects/snapshot.ts';
import { prepareDependencies } from '../projects/worktree-deps.ts';
import type { CheckCommand } from './detect.ts';
import { compareWithBase, environmentProblem, outputShape } from './failures.ts';
import { runCheck, type CheckRun } from './run-check.ts';

const BASELINE_MIN_MS = 60_000;
const BASELINE_FACTOR = 3;

export interface BaselineSite {
  db: Queryable;
  cwd: string;
  base: string;
  signal: AbortSignal;
  limitMs: number;
}

export interface FailedRun {
  check: CheckCommand;
  failures: readonly string[];
  shape: string;
  durationMs: number;
}

export interface Attribution {
  fromChange: boolean;
  baseline: CheckBaseline;
}

interface Place {
  key: Omit<BaselineKey, 'command'>;
  relative: string;
}

interface Copy {
  dir: string;
  cwd: string;
  prepared: boolean;
}

export function baselineLimit(durationMs: number, limitMs: number): number {
  return Math.min(limitMs, Math.max(BASELINE_MIN_MS, durationMs * BASELINE_FACTOR));
}

function usable(run: CheckRun, check: CheckCommand, prepared: boolean): boolean {
  if (run.exitCode === 0 || run.timedOut) return true;
  if (environmentProblem({ argv: check.argv, ...run }) !== null) return false;
  return prepared || run.failures.length > 0;
}

export class Baselines {
  private place: Promise<Place> | null = null;
  private copy: Promise<Copy> | null = null;

  constructor(private readonly site: BaselineSite) {}

  async attribute(failed: FailedRun): Promise<Attribution | null> {
    const found = await this.result(failed).catch(() => undefined);
    if (found === null) return null;
    const base = this.site.base;
    if (!found) {
      return {
        fromChange: true,
        baseline: {
          base,
          outcome: 'unavailable',
          cached: false,
          durationMs: 0,
          shared: [],
          added: [],
        },
      };
    }
    const { record, cached } = found;
    const shown = { base, cached, durationMs: record.durationMs };
    if (record.timedOut) {
      return {
        fromChange: true,
        baseline: { ...shown, outcome: 'timed_out', shared: [], added: [] },
      };
    }
    const passed = record.exitCode === 0;
    const compared = compareWithBase(failed, {
      passed,
      failures: record.failures,
      shape: record.shape,
    });
    return {
      fromChange: compared.fromChange,
      baseline: {
        ...shown,
        outcome: passed ? 'passed' : 'failed',
        shared: compared.shared,
        added: passed ? [] : compared.added,
      },
    };
  }

  async dispose(): Promise<void> {
    const copy = await this.copy?.catch(() => null);
    this.copy = null;
    if (!copy) return;
    await git(this.site.cwd, ['worktree', 'remove', '--force', copy.dir]).catch(() => undefined);
    await rm(copy.dir, { recursive: true, force: true });
    await git(this.site.cwd, ['worktree', 'prune']).catch(() => undefined);
  }

  private async result(
    failed: FailedRun,
  ): Promise<{ record: BaselineRecord; cached: boolean } | null | undefined> {
    const place = await (this.place ??= this.locate());
    const key = { ...place.key, command: failed.check.command };
    const saved = await savedBaseline(this.site.db, key);
    if (saved) return { record: saved, cached: true };
    const copy = await (this.copy ??= this.checkOut(place));
    const run = await runCheck(failed.check, {
      root: copy.dir,
      cwd: copy.cwd,
      timeoutMs: baselineLimit(failed.durationMs, this.site.limitMs),
      signal: this.site.signal,
    });
    if (run.cancelled) return null;
    if (!usable(run, failed.check, copy.prepared)) return undefined;
    const record = {
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      failures: run.failures,
      shape: outputShape(run.outputTail, [copy.cwd, copy.dir]),
      durationMs: run.durationMs,
    };
    await saveBaseline(this.site.db, key, record);
    return { record, cached: false };
  }

  private async locate(): Promise<Place> {
    const { cwd, base } = this.site;
    const [common, top, tree] = await Promise.all([
      git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
      git(cwd, ['rev-parse', '--show-toplevel']),
      git(cwd, ['rev-parse', '--verify', '-q', `${base}^{tree}`]),
    ]);
    const relative = path.relative(top.trim(), await realpath(cwd));
    return {
      key: { repo: await realpath(common.trim()), baseTree: tree.trim(), cwd: relative || '.' },
      relative,
    };
  }

  private async checkOut(place: Place): Promise<Copy> {
    const { cwd, base, signal } = this.site;
    const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-baseline-')));
    await git(cwd, ['worktree', 'add', '--detach', '--quiet', dir, base]);
    const copyCwd = path.join(dir, place.relative);
    const prep = await prepareDependencies(cwd, copyCwd, { root: dir, signal }).catch(() => null);
    return {
      dir,
      cwd: copyCwd,
      prepared: prep === null || (prep.method !== 'skipped' && !prep.stale),
    };
  }
}
