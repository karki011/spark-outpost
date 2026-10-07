import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
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
import type { BaseEvidence } from './attribution.ts';
import { environmentProblem, outputShape } from './failures.ts';
import { runCheck, type CheckRun } from './run-check.ts';

const BASELINE_MIN_MS = 60_000;
const BASELINE_FACTOR = 3;
const BASELINE_FRESH_MS = 3_600_000;
const REAL_RUN_ENV = { NX_SKIP_NX_CACHE: 'true', TURBO_FORCE: 'true' };
const REPLAYED =
  /read the output from the cache|\[(?:local|remote) cache\]|cache hit, replaying|FULL TURBO|FROM-CACHE|\(cached\) PASSED/i;

export interface BaselineSite {
  db: Queryable;
  cwd: string;
  base: string;
  signal: AbortSignal;
  limitMs: number;
  env?: Readonly<Record<string, string>>;
}

export interface FailedRun {
  check: CheckCommand;
  durationMs: number;
}

export interface BaseResult extends BaseEvidence {
  base: string;
  cached: boolean;
  durationMs: number;
}

interface Place {
  key: Omit<BaselineKey, 'command' | 'environment'>;
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

function environmentOf(
  builderEnv: Readonly<Record<string, string>> = {},
  env: NodeJS.ProcessEnv = process.env,
): string {
  const own = Object.entries(builderEnv).sort(([a], [b]) => a.localeCompare(b));
  const facts = [process.version, process.platform, process.arch, env.PATH ?? '', ...own.flat()];
  return createHash('sha256').update(facts.join('\0')).digest('hex');
}

function ranToEnd(run: CheckRun, prepared: boolean): boolean {
  if (run.timedOut || run.exitCode === null) return false;
  return prepared && !REPLAYED.test(run.outputTail);
}

function outcomeOf(record: BaselineRecord): BaseResult['outcome'] {
  if (record.timedOut) return 'timed_out';
  return record.exitCode === 0 ? 'passed' : 'failed';
}

export class Baselines {
  private place: Promise<Place> | null = null;
  private copy: Promise<Copy> | null = null;

  constructor(private readonly site: BaselineSite) {}

  async evidence(failed: FailedRun): Promise<BaseResult | null> {
    const found = await this.result(failed).catch(() => undefined);
    if (found === null) return null;
    const base = this.site.base;
    if (!found) {
      return {
        base,
        outcome: 'unavailable',
        trusted: false,
        cached: false,
        durationMs: 0,
        failures: [],
        shape: '',
      };
    }
    const { record, cached, trusted } = found;
    return {
      base,
      outcome: outcomeOf(record),
      trusted,
      cached,
      durationMs: record.durationMs,
      failures: record.failures,
      shape: record.shape,
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
  ): Promise<{ record: BaselineRecord; cached: boolean; trusted: boolean } | null | undefined> {
    const place = await (this.place ??= this.locate());
    const key = {
      ...place.key,
      command: failed.check.command,
      environment: environmentOf(this.site.env),
    };
    const saved = await savedBaseline(this.site.db, key);
    if (saved && saved.ageMs <= BASELINE_FRESH_MS) {
      return { record: saved, cached: true, trusted: !saved.timedOut };
    }
    const copy = await (this.copy ??= this.checkOut(place));
    const run = await runCheck(failed.check, {
      root: copy.dir,
      cwd: copy.cwd,
      timeoutMs: baselineLimit(failed.durationMs, this.site.limitMs),
      signal: this.site.signal,
      builderEnv: { ...this.site.env, ...REAL_RUN_ENV },
    });
    if (run.cancelled) return null;
    if (!run.timedOut && environmentProblem({ argv: failed.check.argv, ...run }) !== null) {
      return undefined;
    }
    const record = {
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      failures: run.failures,
      shape: outputShape(run.outputTail, [copy.cwd, copy.dir]),
      durationMs: run.durationMs,
    };
    const trusted = ranToEnd(run, copy.prepared);
    if (trusted || run.timedOut) await saveBaseline(this.site.db, key, record);
    return { record, cached: false, trusted };
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
