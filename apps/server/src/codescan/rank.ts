import type { TextMatch } from './ripgrep.ts';
import { isTestFile } from './test-pairs.ts';

export const MAX_CANDIDATES = 255;
export const DAMPING = 0.85;
export const ITERATIONS = 30;
export const WIDELY_DEFINED = 5;

export interface NodeFacts {
  defIds: readonly number[];
  refIds: readonly number[];
  lines: number;
  package: string;
  hasTest: boolean;
}

export interface NameStats {
  defFiles: number;
  refFiles: number;
}

export interface RankInput {
  facts: ReadonlyMap<string, NodeFacts>;
  matches: ReadonlyMap<string, TextMatch>;
  pathHits: ReadonlySet<string>;
  pathWords?: ReadonlyMap<string, number>;
  namedDefiners: ReadonlyMap<string, number>;
  namedIds: ReadonlySet<number>;
  nameStats?: ReadonlyMap<number, NameStats>;
  hubCap?: number;
  uncommitted: ReadonlySet<string>;
  coChange: ReadonlyMap<string, number>;
  churn: ReadonlyMap<string, number>;
  packageOf: (path: string) => string;
  limit?: number;
}

export interface RankedFile {
  path: string;
  score: number;
  matches: number;
  termsMatched: number;
  references: number;
  lines: number | null;
  symbols: number | null;
  churn: number;
  package: string;
  uncommitted: boolean;
  hasTest: boolean | null;
  reasons: string[];
}

interface Edge {
  to: number;
  weight: number;
}

export function evidenceScore(input: RankInput, path: string): number {
  const match = input.matches.get(path);
  const named = input.namedDefiners.get(path) ?? 0;
  let score = 0;
  if (input.pathHits.has(path)) score += 10;
  score += 3 * Math.min(input.pathWords?.get(path) ?? 0, 3);
  if (named > 0) score += (6 + 2 * (named - 1)) * (isTestFile(path) ? 0.5 : 1);
  if (match) score += 2 * match.terms.size + Math.log2(1 + match.count);
  if (input.uncommitted.has(path)) score += 1.5;
  score += 0.5 * Math.min(input.coChange.get(path) ?? 0, 5);
  return score;
}

function nodePaths(input: RankInput): string[] {
  return [
    ...new Set([
      ...input.facts.keys(),
      ...input.matches.keys(),
      ...input.pathHits,
      ...(input.pathWords?.keys() ?? []),
      ...input.uncommitted,
      ...input.coChange.keys(),
    ]),
  ].sort();
}

function definersById(paths: readonly string[], input: RankInput): Map<number, number[]> {
  const definers = new Map<number, number[]>();
  paths.forEach((path, index) => {
    for (const id of input.facts.get(path)?.defIds ?? []) {
      const list = definers.get(id) ?? [];
      list.push(index);
      definers.set(id, list);
    }
  });
  return definers;
}

function referrerCounts(paths: readonly string[], input: RankInput): Map<number, number> {
  const counts = new Map<number, number>();
  for (const path of paths) {
    for (const id of input.facts.get(path)?.refIds ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export function nameWeight(named: boolean, definers: number, referrers: number): number {
  if (named) return 10;
  const spread = definers > WIDELY_DEFINED ? 0.1 : 1;
  return spread / Math.sqrt(Math.max(1, referrers));
}

export function referenceEdges(paths: readonly string[], input: RankInput): Edge[][] {
  const definers = definersById(paths, input);
  const referrers = referrerCounts(paths, input);
  return paths.map((path, from) => {
    const refIds = input.facts.get(path)?.refIds;
    if (!refIds || refIds.length === 0) return [];
    const weights = new Map<number, number>();
    for (const id of refIds) {
      const targets = definers.get(id);
      if (!targets) continue;
      const stats = input.nameStats?.get(id);
      const weight = nameWeight(
        input.namedIds.has(id),
        stats?.defFiles ?? targets.length,
        stats?.refFiles ?? referrers.get(id) ?? 1,
      );
      for (const to of targets) {
        if (to !== from) weights.set(to, (weights.get(to) ?? 0) + weight);
      }
    }
    return [...weights].map(([to, weight]) => ({ to, weight }));
  });
}

export function personalisedPageRank(edges: readonly Edge[][], personal: readonly number[]) {
  const size = personal.length;
  const total = personal.reduce((sum, value) => sum + value, 0);
  const base = Float64Array.from(personal, (value) => (total > 0 ? value / total : 1 / size));
  const outWeight = Float64Array.from(edges, (list) =>
    list.reduce((sum, edge) => sum + edge.weight, 0),
  );
  let rank = Float64Array.from(base);
  let next = new Float64Array(size);
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    for (let index = 0; index < size; index += 1) next[index] = (1 - DAMPING) * base[index]!;
    let dangling = 0;
    for (let from = 0; from < size; from += 1) {
      const value = rank[from]!;
      const out = outWeight[from] ?? 0;
      if (out === 0) {
        dangling += value;
        continue;
      }
      for (const edge of edges[from] ?? []) {
        next[edge.to] = next[edge.to]! + (DAMPING * value * edge.weight) / out;
      }
    }
    for (let index = 0; index < size; index += 1) {
      next[index] = next[index]! + DAMPING * dangling * base[index]!;
    }
    [rank, next] = [next, rank];
  }
  return Array.from(rank);
}

function reasonsFor(input: RankInput, path: string, linked: boolean): string[] {
  const reasons: string[] = [];
  if (input.pathHits.has(path)) reasons.push('named path');
  if (input.pathWords?.has(path)) reasons.push('path words');
  if (input.namedDefiners.has(path)) reasons.push('defines a named symbol');
  if (input.matches.has(path)) reasons.push('text match');
  if (input.uncommitted.has(path)) reasons.push('uncommitted');
  if (input.coChange.has(path)) reasons.push('changes with matches');
  if (reasons.length === 0 && linked) reasons.push('linked by references');
  return reasons;
}

export function reach(input: RankInput, path: string): number {
  let widest = 0;
  for (const id of input.facts.get(path)?.defIds ?? []) {
    widest = Math.max(widest, input.nameStats?.get(id)?.refFiles ?? 0);
  }
  return widest;
}

export function hubFactor(input: RankInput, path: string, evidence: number): number {
  if (evidence > 0 || input.hubCap === undefined) return 1;
  return Math.min(1, input.hubCap / Math.max(1, reach(input, path)));
}

function largest(values: readonly number[]): number {
  return values.reduce((top, value) => Math.max(top, value), Number.MIN_VALUE);
}

function inDegrees(edges: readonly Edge[][], size: number): number[] {
  const degrees = new Array<number>(size).fill(0);
  for (const list of edges) {
    for (const edge of list) degrees[edge.to] = (degrees[edge.to] ?? 0) + 1;
  }
  return degrees;
}

export function rankFiles(input: RankInput): RankedFile[] {
  const paths = nodePaths(input);
  if (paths.length === 0) return [];
  const edges = referenceEdges(paths, input);
  const evidence = paths.map((path) => evidenceScore(input, path));
  const rank = personalisedPageRank(edges, evidence);
  const references = inDegrees(edges, paths.length);
  const topRank = largest(rank);
  const topEvidence = largest(evidence);
  const ranked = paths.map((path, index): RankedFile => {
    const facts = input.facts.get(path);
    const match = input.matches.get(path);
    const own = evidence[index] ?? 0;
    const score =
      (0.5 * ((rank[index] ?? 0) / topRank) + 0.5 * (own / topEvidence)) *
      hubFactor(input, path, own);
    return {
      path,
      score: Math.round(score * 10_000) / 10_000,
      matches: match?.count ?? 0,
      termsMatched: match?.terms.size ?? 0,
      references: references[index] ?? 0,
      lines: facts?.lines ?? null,
      symbols: facts ? facts.defIds.length : null,
      churn: input.churn.get(path) ?? 0,
      package: facts?.package ?? input.packageOf(path),
      uncommitted: input.uncommitted.has(path),
      hasTest: facts?.hasTest ?? null,
      reasons: reasonsFor(input, path, (references[index] ?? 0) > 0),
    };
  });
  ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return ranked.slice(0, input.limit ?? MAX_CANDIDATES);
}
