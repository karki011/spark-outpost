import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { IntakeDeps } from '../advisor/jev-types.ts';
import { headCommit, workingChanges } from '../codescan/git.ts';
import type { CodeScanner } from '../codescan/scanner.ts';
import type { Db, Queryable } from '../persistence/db.ts';
import type { JevAccess } from '../advisor/jev-calls.ts';
import { anySparkPaused } from '../persistence/spark-pause.ts';
import { readIgnore } from '../projects/project-fs.ts';
import { advisorEntry } from '../providers/catalog.ts';
import { buildRepo } from './build.ts';
import { createGate, MapStopped, systemClock, type Clock } from './pace.ts';
import {
  CPU_BUDGET,
  MAP_CHECK_EVERY_MS,
  MAP_JEV_TIMEOUT_MS,
  MAP_POLL_MS,
  MAP_RETRY_FAILED_MS,
  MAP_RULES_VERSION,
} from './policy.ts';
import {
  agentsBusy,
  failRepo,
  markChecked,
  notifyMap,
  pendingRepo,
  queueRepo,
  reposToCheck,
  setProgress,
  syncRepos,
  type RepoRow,
} from './store.ts';

export interface MapSchedulerOptions {
  db: Db;
  scanner: CodeScanner;
  jev: IntakeDeps | null;
  jevTimeoutMs?: number;
  rootPrefix?: string | null;
  pollMs?: number;
  checkEveryMs?: number;
  budget?: number;
  busyCheckMs?: number;
  clock?: Clock;
  signature?: (root: string) => Promise<string>;
}

export interface MapBuilder {
  runOnce(): Promise<boolean>;
  stop(): void;
}

export interface MapScheduler {
  stop(): Promise<void>;
}

export async function repoSignature(root: string): Promise<string> {
  const [head, changed] = await Promise.all([headCommit(root), workingChanges(root)]);
  const hash = createHash('sha1').update(head ?? 'no-head');
  for (const path of [...changed].sort()) {
    const stats = await lstat(join(root, path)).catch(() => null);
    hash.update(`\n${path}:${stats ? `${stats.size}:${Math.trunc(stats.mtimeMs)}` : 'gone'}`);
  }
  return hash.digest('hex');
}

async function jevAccessFor(
  db: Queryable,
  deps: IntakeDeps | null,
  root: string,
  timeoutMs: number,
): Promise<JevAccess | null> {
  if (!deps) return null;
  const { rows } = await db.query<{ model: string | null }>(
    `SELECT ac.model FROM advisor_connections ac
     JOIN projects p ON p.workspace_id = ac.workspace_id
     WHERE p.root_path = $1 AND ac.advisor = 'jev' AND ac.disconnected_at IS NULL
     ORDER BY p.created_at LIMIT 1`,
    [root],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    deps: { ...deps, timeoutMs },
    model: row.model ?? advisorEntry('jev').defaultModel,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createMapBuilder(options: MapSchedulerOptions): MapBuilder {
  const { db } = options;
  const clock = options.clock ?? systemClock;
  const signatureOf = options.signature ?? repoSignature;
  const controller = new AbortController();

  async function staleRepo(): Promise<RepoRow | null> {
    for (const repo of await reposToCheck(db, options.checkEveryMs ?? MAP_CHECK_EVERY_MS)) {
      const signature = await signatureOf(repo.rootPath).catch(() => null);
      const retry =
        repo.status === 'failed' && Date.now() - repo.updatedAt.getTime() > MAP_RETRY_FAILED_MS;
      const changed = signature !== null && signature !== repo.builtSignature;
      if (signature !== null && (changed || retry || repo.rulesVersion !== MAP_RULES_VERSION)) {
        await queueRepo(db, repo.id, signature);
        return { ...repo, status: 'queued', phase: 'index', sourceSignature: signature };
      }
      await markChecked(db, repo.id);
    }
    return null;
  }

  async function build(repo: RepoRow): Promise<void> {
    const gate = createGate({
      budget: options.budget ?? CPU_BUDGET,
      ...(options.busyCheckMs === undefined ? {} : { busyCheckMs: options.busyCheckMs }),
      pollMs: options.pollMs ?? MAP_POLL_MS,
      busy: () => agentsBusy(db),
      onPause: async (paused) => {
        await setProgress(db, repo.id, { status: paused ? 'paused' : 'building' });
        await notifyMap(db, repo.id);
      },
      signal: controller.signal,
      clock,
    });
    try {
      await buildRepo(
        {
          db,
          scanner: options.scanner,
          jev: await jevAccessFor(
            db,
            options.jev,
            repo.rootPath,
            options.jevTimeoutMs ?? MAP_JEV_TIMEOUT_MS,
          ),
          gate,
          signal: controller.signal,
          ignoreFor: readIgnore,
        },
        repo,
      );
    } catch (error) {
      if (error instanceof MapStopped) return;
      console.error(`Could not build the project map for ${repo.rootPath}`, error);
      await failRepo(db, repo.id, message(error));
      await notifyMap(db, repo.id);
    }
  }

  async function runOnce(): Promise<boolean> {
    await syncRepos(db, MAP_RULES_VERSION, options.rootPrefix ?? null);
    if ((await agentsBusy(db)) || (await anySparkPaused(db))) return false;
    const repo = (await pendingRepo(db)) ?? (await staleRepo());
    if (!repo) return false;
    if (repo.sourceSignature) {
      await build(repo);
      return true;
    }
    const signature = await signatureOf(repo.rootPath);
    await queueRepo(db, repo.id, signature);
    await build({ ...repo, sourceSignature: signature });
    return true;
  }

  return { runOnce, stop: () => controller.abort() };
}

export function startMapScheduler(options: MapSchedulerOptions): MapScheduler {
  const builder = createMapBuilder(options);
  const clock = options.clock ?? systemClock;
  const stopped = new AbortController();
  const loop = (async () => {
    while (!stopped.signal.aborted) {
      let worked = false;
      try {
        worked = await builder.runOnce();
      } catch (error) {
        console.error('Project map loop error', error);
      }
      if (!worked) await clock.sleep(options.pollMs ?? MAP_POLL_MS, stopped.signal);
    }
  })();
  return {
    async stop() {
      stopped.abort();
      builder.stop();
      await loop;
    },
  };
}
