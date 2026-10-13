import { access, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { TerminalDependencies } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { git } from '../projects/snapshot.ts';
import { prepareDependencies, type DepsPrep } from '../projects/worktree-deps.ts';
import { endRecordedProcess, recordProcess } from './process-identity.ts';

export interface DepsJob {
  main: string;
  copy: string;
}

export type DepsOutcome = 'prepared' | 'failed' | 'stopped' | 'nothing';

export interface DepsEnded {
  conversationId: string;
  outcome: DepsOutcome;
  method: DepsPrep['method'] | null;
  ms: number;
}

export interface SessionDepsOptions {
  prepare?: typeof prepareDependencies;
  changed?: (conversationId: string) => void;
  ended?: (result: DepsEnded) => void;
  now?: () => number;
}

export interface SessionDeps {
  start(conversationId: string, job: DepsJob): void;
  resume(db: Db, conversationId: string, cwd: string): Promise<void>;
  status(conversationId: string): TerminalDependencies | null;
  stop(conversationId: string): Promise<void>;
  stopAll(): Promise<void>;
}

interface Running {
  controller: AbortController;
  work: Promise<void>;
}

const FAILED = 'Dependencies could not be prepared in this session’s worktree.';
const PENDING_DIR = 'spark-deps';
const PROCESS_FILE = 'process.json';
const STAGING_DIR = 'staging';

async function exists(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  );
}

export async function pendingDir(copy: string): Promise<string | null> {
  const gitDir = await git(copy, ['rev-parse', '--absolute-git-dir']).catch(() => '');
  return gitDir.trim() ? path.join(gitDir.trim(), PENDING_DIR) : null;
}

export function sessionDeps(options: SessionDepsOptions = {}): SessionDeps {
  const prepare = options.prepare ?? prepareDependencies;
  const now = options.now ?? (() => performance.now());
  const running = new Map<string, Running>();
  const shown = new Map<string, TerminalDependencies>();
  const show = (conversationId: string, status: TerminalDependencies | null) => {
    if (status) shown.set(conversationId, status);
    else shown.delete(conversationId);
    options.changed?.(conversationId);
  };

  const run = async (conversationId: string, job: DepsJob, signal: AbortSignal) => {
    const from = now();
    const end = (outcome: DepsOutcome, method: DepsPrep['method'] | null) =>
      options.ended?.({ conversationId, outcome, method, ms: now() - from });
    if (!(await exists(path.join(job.copy, 'package.json')))) return end('nothing', null);
    const pending = await pendingDir(job.copy);
    if (pending) {
      await endRecordedProcess(path.join(pending, PROCESS_FILE));
      if (signal.aborted) return end('stopped', null);
      await rm(pending, { recursive: true, force: true });
      await mkdir(path.join(pending, STAGING_DIR), { recursive: true });
    }
    show(conversationId, { state: 'preparing', step: null, note: null });
    let prep: DepsPrep | null = null;
    let failure: string | null = null;
    try {
      prep = await prepare(job.main, job.copy, {
        root: job.main,
        signal,
        ...(pending
          ? {
              staging: path.join(pending, STAGING_DIR),
              onProcess: (pid: number) =>
                void recordProcess(path.join(pending, PROCESS_FILE), pid).catch(() => undefined),
            }
          : {}),
        onPhase: (step) => {
          if (!signal.aborted) show(conversationId, { state: 'preparing', step, note: null });
        },
      });
      if (prep?.stale) failure = prep.note ?? FAILED;
    } catch {
      failure = FAILED;
    }
    if (signal.aborted) {
      show(conversationId, null);
      return end('stopped', prep?.method ?? null);
    }
    if (pending) await rm(pending, { recursive: true, force: true }).catch(() => undefined);
    show(conversationId, failure ? { state: 'failed', step: null, note: failure } : null);
    return end(failure ? 'failed' : 'prepared', prep?.method ?? null);
  };

  const start = (conversationId: string, job: DepsJob) => {
    if (running.has(conversationId)) return;
    const controller = new AbortController();
    const work = run(conversationId, job, controller.signal)
      .catch(() => undefined)
      .finally(() => {
        if (running.get(conversationId)?.controller === controller) running.delete(conversationId);
      });
    running.set(conversationId, { controller, work });
  };

  const stop = async (conversationId: string) => {
    const job = running.get(conversationId);
    job?.controller.abort();
    await job?.work;
    if (shown.delete(conversationId)) options.changed?.(conversationId);
  };

  return {
    start,
    async resume(db, conversationId, cwd) {
      if (running.has(conversationId)) return;
      const { rows } = await db.query<{ repo_root: string }>(
        `SELECT repo_root FROM chat_worktrees
         WHERE conversation_id = $1 AND path = $2 AND removed_at IS NULL AND NOT in_place`,
        [conversationId, cwd],
      );
      const main = rows[0]?.repo_root;
      if (!main) return;
      const pending = await pendingDir(cwd);
      if (pending && (await exists(pending))) start(conversationId, { main, copy: cwd });
    },
    status: (conversationId) => shown.get(conversationId) ?? null,
    stop,
    stopAll: async () => {
      await Promise.all([...running.keys()].map(stop));
    },
  };
}
