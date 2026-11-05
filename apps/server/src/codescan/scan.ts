import type { Queryable } from '../persistence/db.ts';
import { firstSorted } from './first-sorted.ts';
import { churnByFile, coChanged } from './history.ts';
import { packageMatcher } from './layout.ts';
import { ownersMatcher } from './owners.ts';
import {
  rankFiles,
  WIDELY_DEFINED,
  type NameStats,
  type NodeFacts,
  type RankedFile,
} from './rank.ts';
import { searchText, type TextMatch } from './ripgrep.ts';
import {
  definersOf,
  factsFor,
  loadScanProject,
  nameIds,
  neighbours,
  pathsLike,
  pathsWithWords,
  namesContaining,
  nameStats,
  type ScanProject,
} from './scan-store.ts';
import { isSkipped } from './skip.ts';
import { recentWorkingChanges } from './status-cache.ts';
import { extractTerms, pascalForm, searchPatterns, spellings, type RequestTerms } from './terms.ts';

export const CORE_SEEDS = 30;
export const MAX_SEEDS = 300;
const MAX_REFERENCED_IDS = 3000;
const MAX_DEFINED_IDS = 1000;
const MAX_STAT_IDS = 20_000;
const SPECIFIC_MIN_FILES = 25;
const SPECIFIC_SHARE = 0.01;
const MAX_CO_CHANGES = 10;
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
  pathWords: Map<string, number>;
  named: Map<string, number>;
  namedDefiners: Map<string, number[]>;
  nameStats: Map<number, NameStats>;
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
    pathWords: new Map(),
    named: new Map(),
    namedDefiners: new Map(),
    nameStats: new Map(),
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
  const status = timed(timings, 'gitStatus', abortable(recentWorkingChanges(root), signal));
  status.catch(() => undefined);
  const project = await timed(timings, 'project', abortable(loadScanProject(db, root), signal));
  const excludes = project?.layout.searchExcludes ?? [];
  const [matches, uncommitted] = await Promise.all([
    timed(timings, 'ripgrep', searchText(root, searchPatterns(terms), excludes, signal)),
    status,
  ]);
  evidence.matches = matches;
  const changed = uncommitted.filter((path) => !isSkipped(path));
  evidence.uncommitted = new Set(changed.slice(0, MAX_UNCOMMITTED));
  evidence.project = project;
}

function strongestPaths(evidence: Evidence): string[] {
  const weight = (path: string) =>
    (evidence.pathHits.has(path) ? 100 : 0) +
    (evidence.pathWords.get(path) ?? 0) * 20 +
    (evidence.namedDefiners.has(path) ? 50 : 0) +
    (evidence.matches.get(path)?.terms.size ?? 0) * 5 +
    Math.log2(1 + (evidence.matches.get(path)?.count ?? 0));
  const weights = new Map<string, number>();
  for (const paths of [
    evidence.pathHits,
    evidence.pathWords.keys(),
    evidence.namedDefiners.keys(),
    evidence.matches.keys(),
    evidence.uncommitted,
  ]) {
    for (const path of paths) if (!weights.has(path)) weights.set(path, weight(path));
  }
  return firstSorted(
    [...weights],
    MAX_SEEDS,
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  ).map(([path]) => path);
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
  const variants = terms.identifiers.flatMap(spellings);
  const [named, pathHits, pathWords] = await Promise.all([
    abortable(nameIds(db, project.id, variants), signal),
    abortable(pathsLike(db, project.id, [...terms.paths, ...terms.fileNames]), signal),
    abortable(pathsWithWords(db, project.id, terms.words), signal),
  ]);
  evidence.named = named;
  evidence.pathHits = new Set(pathHits);
  evidence.pathWords = pathWords;
  evidence.nameStats = await abortable(nameStats(db, project.id, [...named.values()]), signal);
  const partial = undefinedTerms(terms.identifiers, named, evidence.nameStats).map(pascalForm);
  const widened = await abortable(namesContaining(db, project.id, partial), signal);
  for (const [name, id] of widened) named.set(name, id);
  await addNameStats(db, project, evidence, [...widened.values()], signal);
  evidence.namedDefiners = await abortable(definersOf(db, project.id, [...named.values()]), signal);
  const ordered = strongestPaths(evidence);
  const core = ordered.slice(0, CORE_SEEDS);
  const coChanges = [...coChanged(project.history, new Set(core))];
  evidence.coChange = new Map(coChanges.sort((a, b) => b[1] - a[1]).slice(0, MAX_CO_CHANGES));
  const seeds = [...new Set([...ordered.slice(0, MAX_SEEDS), ...evidence.coChange.keys()])];
  evidence.facts = await timed(
    timings,
    'facts',
    abortable(factsFor(db, project.id, seeds), signal),
  );
  await expandNeighbours(db, project, evidence, core, seeds, timings, signal);
}

export function undefinedTerms(
  identifiers: readonly string[],
  named: ReadonlyMap<string, number>,
  stats: ReadonlyMap<number, NameStats>,
): string[] {
  return identifiers.filter((term) => {
    if (term.length < 4) return false;
    return !spellings(term).some((variant) => {
      const id = named.get(variant);
      return id !== undefined && (stats.get(id)?.defFiles ?? 0) > 0;
    });
  });
}

export function specificCap(fileCount: number): number {
  return Math.max(SPECIFIC_MIN_FILES, Math.round(fileCount * SPECIFIC_SHARE));
}

async function addNameStats(
  db: Queryable,
  project: ScanProject,
  evidence: Evidence,
  ids: readonly number[],
  signal: AbortSignal,
): Promise<void> {
  const missing = ids.filter((id) => !evidence.nameStats.has(id)).slice(0, MAX_STAT_IDS);
  const stats = await abortable(nameStats(db, project.id, missing), signal);
  for (const [id, entry] of stats) evidence.nameStats.set(id, entry);
}

async function expandNeighbours(
  db: Queryable,
  project: ScanProject,
  evidence: Evidence,
  core: readonly string[],
  seeds: readonly string[],
  timings: Record<string, number>,
  signal: AbortSignal,
): Promise<void> {
  const coreFacts = core.flatMap((path) => evidence.facts.get(path) ?? []);
  const referenced = unionIds(coreFacts, (entry) => entry.refIds, MAX_REFERENCED_IDS);
  const defined = unionIds(coreFacts, (entry) => entry.defIds, MAX_DEFINED_IDS);
  await timed(
    timings,
    'nameStats',
    addNameStats(db, project, evidence, [...referenced, ...defined], signal),
  );
  const cap = specificCap(project.fileCount);
  const stat = (id: number) => evidence.nameStats.get(id);
  const specific = referenced.filter((id) => {
    const entry = stat(id);
    return entry !== undefined && entry.defFiles <= WIDELY_DEFINED && entry.refFiles <= cap;
  });
  const used = defined.filter((id) => {
    const refFiles = stat(id)?.refFiles ?? 0;
    return refFiles > 0 && refFiles <= cap;
  });
  const around = await timed(
    timings,
    'neighbours',
    abortable(neighbours(db, project.id, specific, used, seeds), signal),
  );
  for (const [path, facts] of around) evidence.facts.set(path, facts);
  const allIds = [
    ...unionIds(evidence.facts.values(), (entry) => entry.refIds, MAX_STAT_IDS),
    ...unionIds(evidence.facts.values(), (entry) => entry.defIds, MAX_STAT_IDS),
  ];
  await timed(timings, 'edgeStats', addNameStats(db, project, evidence, allIds, signal));
}

function summarise(evidence: Evidence, candidates: readonly RankedFile[]): ScanSummary {
  const top = candidates.slice(0, SUMMARY_TOP);
  const layout = evidence.project?.layout;
  const ownersOf = ownersMatcher(layout?.owners ?? []);
  const owners = new Set(top.flatMap((file) => ownersOf(file.path)));
  return {
    packagesTouched: [...new Set(top.map((file) => file.package))],
    ownersTouched: owners.size,
    namedSymbols: [...evidence.named].map(([name, id]) => ({
      name,
      definedIn: evidence.nameStats.get(id)?.defFiles ?? 0,
      referencedBy: evidence.nameStats.get(id)?.refFiles ?? 0,
    })),
    uncommitted: evidence.uncommitted.size,
    instructions: layout?.instructions ?? [],
    tools: layout?.tools ?? [],
  };
}

async function report(
  evidence: Evidence,
  terms: RequestTerms,
  timings: Record<string, number>,
  partial: boolean,
): Promise<ScanReport> {
  const layout = evidence.project?.layout;
  const candidates = await rankFiles({
    facts: evidence.facts,
    matches: evidence.matches,
    pathHits: evidence.pathHits,
    pathWords: evidence.pathWords,
    namedDefiners: new Map([...evidence.namedDefiners].map(([path, ids]) => [path, ids.length])),
    namedIds: new Set(evidence.named.values()),
    nameStats: evidence.nameStats,
    hubCap: specificCap(evidence.project?.fileCount ?? 0),
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
  const result = await report(evidence, terms, timings, partial);
  timings.total = Math.round(performance.now() - started);
  if (partial && result.candidates.length === 0) return null;
  return result;
}
