import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  parseCloneUrl,
  type CloneJob,
  type Project,
  type StartCloneRequest,
} from '@spark-outpost/contracts';
import type { Db } from '../../persistence/db.ts';
import { newId } from '../../persistence/ids.ts';
import {
  cloneMarkers,
  deleteCloneMarker,
  saveCloneMarker,
  updateCloneMarker,
  type CloneMarker,
  type DirectoryIdentity,
} from '../../persistence/project-clones.ts';
import { withTokenAccess } from '../../ship/push.ts';
import { createProject, displayPath, listProjects } from '../projects.ts';
import {
  claimDestination,
  CloneRefusedError,
  destinationAt,
  removeClaimed,
  resolveDestination,
  type Destination,
} from './clone-destination.ts';
import {
  canRetryWithToken,
  cloneFailure,
  CLONE_SUMMARIES,
  type CloneFailure,
} from './clone-failure.ts';
import { cloneEnvironment, startGitClone, type GitCloneProcess } from './clone-git.ts';
import { advance, CONNECTING, type CloneProgress } from './clone-progress.ts';

export interface CloneJobsDeps {
  db: Db;
  workspaceId: string;
  home: () => Promise<string>;
  reserved: readonly string[];
  tokensFor: (url: string) => Promise<string[]>;
  loginEnv: () => Promise<Record<string, string>>;
  gitPath?: string;
  allowFileProtocol?: boolean;
}

export interface ResearchCopy {
  destination: string;
}

export interface CloneJobs {
  start(
    request: StartCloneRequest,
    research?: ResearchCopy,
  ): Promise<{ job: CloneJob; started: boolean }>;
  settled(id: string): Promise<CloneJob | null>;
  cancel(id: string): Promise<CloneJob | null>;
  dismiss(id: string): boolean;
  list(): CloneJob[];
  recover(): Promise<void>;
  stopAll(): void;
}

interface Entry {
  id: string;
  source: string;
  destination: string;
  home: string;
  status: CloneJob['status'];
  progress: CloneProgress;
  project: Project | null;
  failure: CloneFailure | null;
  startedAt: Date;
  identity: DirectoryIdentity | null;
  process: GitCloneProcess | null;
  cancelled: boolean;
  research: boolean;
  finished: Promise<void>;
}

const PS_TIMEOUT_MS = 5_000;
const UNEXPECTED = 'Spark hit an unexpected error.';
const CANCELLED: CloneFailure = { kind: 'other', summary: '', detail: '' };
const LEAKED: CloneFailure = {
  kind: 'other',
  summary: CLONE_SUMMARIES.other,
  detail: 'The clone would have saved a sign-in in its git settings, so Spark removed it.',
};
const CREDENTIALS_IN_CONFIG = /:\/\/[^/\s@]+:[^/\s@]+@/;
const RESEARCH_ENV = { GIT_LFS_SKIP_SMUDGE: '1' };

function toJob(entry: Entry): CloneJob {
  return {
    id: entry.id,
    source: entry.source,
    destination: entry.destination,
    displayPath: displayPath(entry.destination, entry.home),
    status: entry.status,
    phase: entry.progress.phase,
    percent: entry.progress.percent,
    project: entry.project,
    failure: entry.failure,
    startedAt: entry.startedAt.toISOString(),
  };
}

function commandOf(pid: number): Promise<string> {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'command=', '-p', String(pid)], { timeout: PS_TIMEOUT_MS }, (_e, out) =>
      resolve(String(out)),
    );
  });
}

function parentOf(pid: number): Promise<number | null> {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'ppid=', '-p', String(pid)], { timeout: PS_TIMEOUT_MS }, (_e, out) => {
      const parent = Number.parseInt(String(out).trim(), 10);
      resolve(Number.isFinite(parent) ? parent : null);
    });
  });
}

async function runningClone(marker: CloneMarker): Promise<boolean> {
  if (!marker.pid) return false;
  const command = await commandOf(marker.pid);
  return command.includes(' clone ') && command.includes(marker.destination);
}

async function ownedElsewhere(marker: CloneMarker): Promise<boolean> {
  if (!marker.pid || !(await runningClone(marker))) return false;
  const parent = await parentOf(marker.pid);
  return parent !== null && parent > 1 && parent !== process.pid;
}

async function stopOrphan(marker: CloneMarker): Promise<void> {
  if (!marker.pid || !(await runningClone(marker))) return;
  try {
    process.kill(-marker.pid, 'SIGKILL');
  } catch {
    return;
  }
}

async function configLeak(destination: string, tokens: readonly string[]): Promise<boolean> {
  const config = await readFile(path.join(destination, '.git', 'config'), 'utf8').catch(() => '');
  return CREDENTIALS_IN_CONFIG.test(config) || tokens.some((token) => config.includes(token));
}

export function createCloneJobs(deps: CloneJobsDeps): CloneJobs {
  const entries = new Map<string, Entry>();
  const gitPath = deps.gitPath ?? 'git';
  const allowFileProtocol = deps.allowFileProtocol === true;

  async function discard(entry: Entry): Promise<void> {
    if (entry.identity) await removeClaimed(entry.destination, entry.identity);
    await deleteCloneMarker(deps.db, entry.id).catch(() => undefined);
  }

  async function attempt(
    entry: Entry,
    extraEnv: Record<string, string>,
    config: readonly string[],
  ) {
    const env = {
      ...cloneEnvironment(process.env, { allowFileProtocol }),
      ...(await deps.loginEnv()),
      ...(entry.research ? RESEARCH_ENV : {}),
      ...extraEnv,
    };
    if (entry.cancelled) return { code: -1, output: '' };
    const running = startGitClone({
      gitPath,
      url: entry.source,
      destination: entry.destination,
      env,
      config,
      shallow: entry.research,
      onLine: (line) => {
        entry.progress = advance(entry.progress, line);
      },
    });
    entry.process = running;
    if (entry.identity && !entry.research) {
      await updateCloneMarker(deps.db, entry.id, { identity: entry.identity, pid: running.pid });
    }
    if (entry.cancelled) running.stop();
    const result = await running.done;
    entry.process = null;
    return result;
  }

  async function reclaim(entry: Entry): Promise<void> {
    if (entry.identity) await removeClaimed(entry.destination, entry.identity);
    entry.identity = await claimDestination({ path: entry.destination, state: 'missing' });
    entry.progress = CONNECTING;
  }

  async function cloneWithCredentials(entry: Entry, used: string[]): Promise<CloneFailure | null> {
    const first = await attempt(entry, {}, []);
    if (first.code === 0) return null;
    if (entry.cancelled) return CANCELLED;
    let failure = cloneFailure(first.output, []);
    if (!canRetryWithToken(failure.kind)) return failure;
    for (const token of await deps.tokensFor(entry.source).catch(() => [])) {
      used.push(token);
      await reclaim(entry);
      const result = await withTokenAccess(token, (access) =>
        attempt(entry, access.env, access.config),
      );
      if (result.code === 0) return null;
      if (entry.cancelled) return CANCELLED;
      failure = cloneFailure(result.output, used);
      if (!canRetryWithToken(failure.kind)) return failure;
    }
    return failure;
  }

  async function run(entry: Entry): Promise<void> {
    let failure: CloneFailure | null;
    const used: string[] = [];
    try {
      failure = await cloneWithCredentials(entry, used);
      if (!failure && (await configLeak(entry.destination, used))) failure = LEAKED;
      if (!failure && !entry.research) {
        entry.project = (await createProject(deps.db, deps.workspaceId, entry.destination)).project;
      }
    } catch (error) {
      failure = {
        kind: 'other',
        summary: CLONE_SUMMARIES.other,
        detail:
          error instanceof CloneRefusedError ? error.message : 'Spark hit an unexpected error.',
      };
      if (!(error instanceof CloneRefusedError)) console.error(error);
    }
    if (!failure) {
      await deleteCloneMarker(deps.db, entry.id).catch(() => undefined);
      entry.progress = { phase: 'Done', percent: 100 };
      entry.status = 'done';
      return;
    }
    await discard(entry);
    entry.failure = entry.cancelled ? null : failure;
    entry.status = entry.cancelled ? 'cancelled' : 'failed';
  }

  async function destinationOf(
    request: StartCloneRequest,
    home: string,
    research: ResearchCopy | undefined,
  ): Promise<Destination> {
    if (research) return destinationAt(research.destination);
    const projects = await listProjects(deps.db, deps.workspaceId);
    return resolveDestination(request.parentPath, request.name, {
      home,
      projectRoots: projects.map((project) => project.rootPath),
      reserved: deps.reserved,
    });
  }

  return {
    async start(request, research) {
      const parsed = parseCloneUrl(request.url, { allowFile: allowFileProtocol });
      if (!parsed.ok) throw new CloneRefusedError(parsed.message);
      const home = await deps.home();
      const destination = await destinationOf(request, home, research);
      const running = [...entries.values()].find(
        (candidate) => candidate.status === 'cloning' && candidate.destination === destination.path,
      );
      if (running) return { job: toJob(running), started: false };
      const entry: Entry = {
        id: newId(),
        source: parsed.source.url,
        destination: destination.path,
        home,
        status: 'cloning',
        progress: CONNECTING,
        project: null,
        failure: null,
        startedAt: new Date(),
        identity: null,
        process: null,
        cancelled: false,
        research: research !== undefined,
        finished: Promise.resolve(),
      };
      entries.set(entry.id, entry);
      try {
        entry.identity = await claimDestination(destination);
        if (!entry.research) {
          await saveCloneMarker(deps.db, deps.workspaceId, {
            id: entry.id,
            source: entry.source,
            destination: entry.destination,
            identity: entry.identity,
          });
        }
      } catch (error) {
        entries.delete(entry.id);
        if (entry.identity) await removeClaimed(entry.destination, entry.identity);
        throw error;
      }
      entry.finished = run(entry).catch((error: unknown) => {
        console.error(error);
        entry.failure = { kind: 'other', summary: CLONE_SUMMARIES.other, detail: UNEXPECTED };
        entry.status = 'failed';
      });
      return { job: toJob(entry), started: true };
    },

    async settled(id) {
      const entry = entries.get(id);
      if (!entry) return null;
      await entry.finished;
      return toJob(entry);
    },

    async cancel(id) {
      const entry = entries.get(id);
      if (!entry) return null;
      if (entry.status === 'cloning') {
        entry.cancelled = true;
        entry.process?.stop();
        await entry.finished;
      }
      return toJob(entry);
    },

    dismiss(id) {
      const entry = entries.get(id);
      if (!entry || entry.status === 'cloning') return false;
      return entries.delete(id);
    },

    list() {
      return [...entries.values()]
        .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
        .map(toJob);
    },

    async recover() {
      const home = await deps.home();
      for (const marker of await cloneMarkers(deps.db, deps.workspaceId)) {
        if (entries.has(marker.id) || (await ownedElsewhere(marker))) continue;
        await stopOrphan(marker);
        const removed = await removeClaimed(marker.destination, marker.identity);
        await deleteCloneMarker(deps.db, marker.id);
        entries.set(marker.id, {
          id: marker.id,
          source: marker.source,
          destination: marker.destination,
          home,
          status: 'failed',
          progress: CONNECTING,
          project: null,
          failure: {
            kind: 'interrupted',
            summary: CLONE_SUMMARIES.interrupted,
            detail:
              removed === 'changed'
                ? 'Spark left the folder alone because it changed while Spark was closed.'
                : 'The partly cloned folder was removed. Start the clone again.',
          },
          startedAt: marker.startedAt,
          identity: null,
          process: null,
          cancelled: false,
          research: false,
          finished: Promise.resolve(),
        });
      }
    },

    stopAll() {
      for (const entry of entries.values()) entry.process?.stop();
    },
  };
}
