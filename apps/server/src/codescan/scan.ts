import type { Queryable } from '../persistence/db.ts';
import { workingChanges } from './git.ts';
import { churnByFile, coChanged } from './history.ts';
import { packageMatcher } from './layout.ts';
import { ownersMatcher } from './owners.ts';
import { rankFiles, type NodeFacts, type RankedFile } from './rank.ts';
import { searchText, type TextMatch } from './ripgrep.ts';
import {
  definersOf,
  factsFor,
  loadScanProject,
  nameIds,
  neighbours,
  pathsLike,
  referenceCounts,
  type ScanProject,
} from './scan-store.ts';
import { isSkipped } from './skip.ts';
import { extractTerms, nameVariants, searchPatterns, type RequestTerms } from './terms.ts';

export const CORE_SEEDS = 30;
export const MAX_SEEDS = 300;
const MAX_REFERENCED_IDS = 3000;
const MAX_DEFINED_IDS = 1000;
const SUMMARY_TOP = 20;
const MAX_UNCOMMITTED = 100;

export interface NamedSymbol {
  name: string;
  definedIn: number;
  referencedBy: number;
}

export interface ScanSummary {
  packagesTouched: string[];
  ownersTouched: number;
  namedSymbols: NamedSymbol[];
  uncommitted: number;
  instructions: string[];
  tools: string[];
}

export interface ScanReport {
  index: 'ready' | 'building' | 'missing';
  indexedFiles: number;
  partial: boolean;
  timings: Record<string, number>;
  terms: RequestTerms;
  candidates: RankedFile[];
  summary: ScanSummary;
}

interface Evidence {
  project: ScanProject | null;
  matches: Map<string, TextMatch>;
  uncommitted: Set<string>;
  pathHits: Set<string>;
  named: Map<string, number>;
  namedDefiners: Map<string, number[]>;
  references: Map<number, number>;
  facts: Map<string, NodeFacts>;
  coChange: Map<string, number>;
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

function emptyEvidence(): Evidence {
  return {
    project: null,
    matches: new Map(),
    uncommitted: new Set(),
    pathHits: new Set(),
    named: new Map(),
    namedDefiners: new Map(),
    references: new Map(),
    facts: new Map(),
    coChange: new Map(),
  };
}

function timed<T>(timings: Record<string, number>, key: string, work: Promise<T>): Promise<T> {
  const started = performance.now();
  return work.finally(() => {
    timings[key] = Math.round(performance.now() - started);
  });
}

async function gatherText(
  db: Queryable,
  root: string,
  terms: RequestTerms,
  evidence: Evidence,
  timings: Record<string, number>,
  signal: AbortSignal,
): Promise<void> {
  const [matches, uncommitted, project] = await Promise.all([
    timed(timings, 'ripgrep', searchText(root, searchPatterns(terms), signal)),
    timed(timings, 'gitStatus', workingChanges(root, signal)),
    timed(timings, 'project', abortable(loadScanProject(db, root), signal)),
  ]);
  evidence.matches = matches;
  const changed = uncommitted.filter((path) => !isSkipped(path));
  evidence.uncommitted = new Set(changed.slice(0, MAX_UNCOMMITTED));
  evidence.project = project;
}

function topByEvidence(evidence: Evidence, limit: number): string[] {
  const weight = (path: string) =>
    (evidence.pathHits.has(path) ? 100 : 0) +
    (evidence.namedDefiners.has(path) ? 50 : 0) +
    (evidence.matches.get(path)?.terms.size ?? 0) * 5 +
    Math.log2(1 + (evidence.matches.get(path)?.count ?? 0));
  const paths = new Set([
    ...evidence.pathHits,
    ...evidence.namedDefiners.keys(),
    ...evidence.matches.keys(),
    ...evidence.uncommitted,
  ]);
  return [...paths].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b)).slice(0, limit);
}

function unionIds(
  facts: Iterable<NodeFacts>,
  pick: (entry: NodeFacts) => readonly number[],
  cap: number,
) {
  const ids = new Set<number>();
  for (const entry of facts) {
    for (const id of pick(entry)) {
      if (ids.size >= cap) return [...ids];
      ids.add(id);
    }
  }
  return [...ids];
}

async function gatherSymbols(
  db: Queryable,
  terms: RequestTerms,
  evidence: Evidence,
  timings: Record<string, number>,
  signal: AbortSignal,
): Promise<void> {
  const project = evidence.project;
  if (!project) return;
  const variants = terms.identifiers.flatMap(nameVariants);
  const [named, pathHits] = await Promise.all([
    abortable(nameIds(db, project.id, variants), signal),
    abortable(pathsLike(db, project.id, [...terms.paths, ...terms.fileNames]), signal),
  ]);
  evidence.named = named;
  evidence.pathHits = new Set(pathHits);
  const ids = [...named.values()];
  const [definers, references] = await Promise.all([
    abortable(definersOf(db, project.id, ids), signal),
    abortable(referenceCounts(db, project.id, ids), signal),
  ]);
  evidence.namedDefiners = definers;
  evidence.references = references;
  const core = topByEvidence(evidence, CORE_SEEDS);
  evidence.coChange = coChanged(project.history, new Set(core));
  const coChanged10 = [...evidence.coChange].sort((a, b) => b[1] - a[1]).slice(0, 10);
  evidence.coChange = new Map(coChanged10);
  const seeds = [...new Set([...topByEvidence(evidence, MAX_SEEDS), ...evidence.coChange.keys()])];
  evidence.facts = await timed(
    timings,
    'facts',
    abortable(factsFor(db, project.id, seeds), signal),
  );
  const coreFacts = core.flatMap((path) => evidence.facts.get(path) ?? []);
  const around = await timed(
    timings,
    'neighbours',
    abortable(
      neighbours(
        db,
        project.id,
        unionIds(coreFacts, (entry) => entry.refIds, MAX_REFERENCED_IDS),
        unionIds(coreFacts, (entry) => entry.defIds, MAX_DEFINED_IDS),
        seeds,
      ),
      signal,
    ),
  );
  for (const [path, facts] of around) evidence.facts.set(path, facts);
}

function summarise(evidence: Evidence, candidates: readonly RankedFile[]): ScanSummary {
  const top = candidates.slice(0, SUMMARY_TOP);
  const layout = evidence.project?.layout;
  const ownersOf = ownersMatcher(layout?.owners ?? []);
  const owners = new Set(top.flatMap((file) => ownersOf(file.path)));
  const definedIn = new Map<number, number>();
  for (const ids of evidence.namedDefiners.values()) {
    for (const id of ids) definedIn.set(id, (definedIn.get(id) ?? 0) + 1);
  }
  return {
    packagesTouched: [...new Set(top.map((file) => file.package))],
    ownersTouched: owners.size,
    namedSymbols: [...evidence.named].map(([name, id]) => ({
      name,
      definedIn: definedIn.get(id) ?? 0,
      referencedBy: evidence.references.get(id) ?? 0,
    })),
    uncommitted: evidence.uncommitted.size,
    instructions: layout?.instructions ?? [],
    tools: layout?.tools ?? [],
  };
}

function report(
  evidence: Evidence,
  terms: RequestTerms,
  timings: Record<string, number>,
  partial: boolean,
): ScanReport {
  const layout = evidence.project?.layout;
  const candidates = rankFiles({
    facts: evidence.facts,
    matches: evidence.matches,
    pathHits: evidence.pathHits,
    namedDefiners: new Map([...evidence.namedDefiners].map(([path, ids]) => [path, ids.length])),
    namedIds: new Set(evidence.named.values()),
    uncommitted: evidence.uncommitted,
    coChange: evidence.coChange,
    churn: churnByFile(evidence.project?.history ?? []),
    packageOf: packageMatcher(layout?.packages ?? []),
  });
  return {
    index: evidence.project ? evidence.project.status : 'missing',
    indexedFiles: evidence.project?.fileCount ?? 0,
    partial,
    timings,
    terms,
    candidates,
    summary: summarise(evidence, candidates),
  };
}

export async function scanRequest(
  db: Queryable,
  root: string,
  request: string,
  signal: AbortSignal,
): Promise<ScanReport | null> {
  const started = performance.now();
  const timings: Record<string, number> = {};
  const terms = extractTerms(request);
  const evidence = emptyEvidence();
  let partial = false;
  try {
    await gatherText(db, root, terms, evidence, timings, signal);
    await timed(timings, 'symbols', gatherSymbols(db, terms, evidence, timings, signal));
  } catch (error) {
    if (!signal.aborted) throw error;
    partial = true;
  }
  const result = report(evidence, terms, timings, partial);
  timings.total = Math.round(performance.now() - started);
  if (partial && result.candidates.length === 0) return null;
  return result;
}
