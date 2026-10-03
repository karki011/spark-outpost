import { basename } from 'node:path';
import { textReader } from '../codescan/file-stats.ts';
import type { CodeScanner } from '../codescan/scanner.ts';
import type { Db } from '../persistence/db.ts';
import type { JevAccess } from '../orchestration/jev-calls.ts';
import { sendable } from './label-evidence.ts';
import { labelAreas } from './labeller.ts';
import { computePairLinks, saveLinks, stalePairs, type LinkSide } from './links.ts';
import { buildModel } from './model.ts';
import { writeModel } from './model-store.ts';
import type { Gate } from './pace.ts';
import { MAP_RULES_VERSION, PROGRESS_EVERY_MS } from './policy.ts';
import { readResolverConfig } from './resolver-config.ts';
import { createResolver } from './resolve.ts';
import {
  finishRepo,
  indexedCommit,
  loadPrevious,
  loadSources,
  notifyMap,
  setProgress,
  type MapPhase,
  type RepoRow,
} from './store.ts';

export interface BuildDeps {
  db: Db;
  scanner: CodeScanner;
  jev: JevAccess | null;
  gate: Gate;
  signal: AbortSignal;
  ignoreFor: (root: string) => Promise<string[]>;
}

export class MapSourceMissing extends Error {
  constructor(root: string) {
    super(`The code index for ${root} is not ready.`);
  }
}

function progressReporter(deps: BuildDeps, repoId: string) {
  let lastAt = 0;
  return async (phase: MapPhase, done: number, total: number, jevAreas?: number) => {
    await setProgress(deps.db, repoId, {
      status: 'building',
      phase,
      done,
      total,
      ...(jevAreas === undefined ? {} : { jevAreas }),
    });
    const now = Date.now();
    if (now - lastAt < PROGRESS_EVERY_MS && done !== total) return;
    lastAt = now;
    await notifyMap(deps.db, repoId);
  };
}

function safeReader(root: string, ignore: readonly string[]) {
  const read = textReader(root);
  return (path: string) => (sendable(path, ignore) ? read(path) : Promise.resolve(null));
}

async function graphPhase(deps: BuildDeps, repo: RepoRow): Promise<void> {
  const sources = await loadSources(deps.db, repo.rootPath);
  if (!sources) throw new MapSourceMissing(repo.rootPath);
  const paths = sources.files.map((file) => file.path);
  const config = await readResolverConfig(paths, textReader(repo.rootPath));
  const model = await buildModel({
    files: sources.files,
    packages: sources.packages,
    owners: sources.owners,
    history: sources.history,
    resolver: createResolver(new Set(paths), config),
    previous: await loadPrevious(deps.db, repo.id),
    yieldNow: () => deps.gate.step(),
  });
  await writeModel(deps.db, repo.id, model, MAP_RULES_VERSION);
}

async function linksPhase(
  deps: BuildDeps,
  repo: RepoRow,
  report: ReturnType<typeof progressReporter>,
) {
  const self: LinkSide = {
    repoId: repo.id,
    rootPath: repo.rootPath,
    signature: repo.sourceSignature ?? '',
  };
  const others = await stalePairs(deps.db, self);
  const ignore = new Map<string, string[]>();
  for (const side of [self, ...others])
    ignore.set(side.rootPath, await deps.ignoreFor(side.rootPath));
  const readerFor = (root: string) => {
    const rules = ignore.get(root) ?? [];
    return { read: safeReader(root, rules), ignore: rules };
  };
  for (const [index, other] of others.entries()) {
    await deps.gate.step();
    const links = await computePairLinks({ ...deps, readerFor }, self, other);
    await saveLinks(deps.db, self, other, links);
    await report('links', index + 1, others.length);
  }
}

export async function buildRepo(deps: BuildDeps, repo: RepoRow): Promise<Record<string, number>> {
  const report = progressReporter(deps, repo.id);
  const timings: Record<string, number> = {};
  const timed = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    try {
      return await work();
    } finally {
      timings[name] = Math.round(performance.now() - started);
    }
  };
  const phases: MapPhase[] = ['index', 'graph', 'labels', 'links'];
  const from = phases.indexOf(repo.phase === 'done' ? 'index' : repo.phase);
  for (const phase of phases.slice(Math.max(0, from))) {
    await report(phase, 0, 0);
    await deps.gate.step();
    if (phase === 'index') {
      await timed('indexMs', () =>
        deps.scanner.ensureIndexed(repo.rootPath, {
          fresh: true,
          pace: async (done, total) => {
            await deps.gate.yield();
            await report('index', done, total);
          },
        }),
      );
    }
    if (phase === 'graph') await timed('graphMs', () => graphPhase(deps, repo));
    if (phase === 'labels') {
      const ignore = await deps.ignoreFor(repo.rootPath);
      const totals = await timed('labelsMs', () =>
        labelAreas({
          db: deps.db,
          repoId: repo.id,
          repoName: basename(repo.rootPath),
          jev: deps.jev,
          gate: deps.gate,
          signal: deps.signal,
          read: safeReader(repo.rootPath, ignore),
          ignore,
          progress: (done, total, jevAreas) => report('labels', done, total, jevAreas),
        }),
      );
      timings.jevCalls = totals.asked;
      timings.jevCached = totals.cached;
      timings.jevInputTokens = totals.inputTokens;
      timings.jevCostMicroUsd = Math.round(totals.costUsd * 1_000_000);
    }
    if (phase === 'links') await timed('linksMs', () => linksPhase(deps, repo, report));
  }
  await finishRepo(deps.db, repo.id, {
    commit: await indexedCommit(deps.db, repo.rootPath),
    timings,
  });
  await notifyMap(deps.db, repo.id);
  return timings;
}
