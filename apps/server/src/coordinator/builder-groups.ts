import path from 'node:path';
import { PIECE_BELOW_CHAT_KINDS } from '../advisor/policy.ts';
import type { PieceAnswer, ScoreSignal } from './piece-questions.ts';

export interface GroupTask {
  key: string;
  files: readonly string[];
  areas: readonly string[];
  destructive: boolean;
  repo: string;
}

interface Group {
  tasks: GroupTask[];
  first: number;
  last: number;
}

function joinable(a: Group, b: Group): boolean {
  const left = a.tasks[0]!;
  const right = b.tasks[0]!;
  return left.destructive === right.destructive && left.repo === right.repo;
}

function shared<T>(a: readonly T[], b: readonly T[]): number {
  const set = new Set(a);
  return new Set(b.filter((item) => set.has(item))).size;
}

function filesOf(group: Group): string[] {
  return group.tasks.flatMap((task) => task.files);
}

function folders(group: Group): string[] {
  return filesOf(group)
    .map((file) => path.posix.dirname(file))
    .filter((dir) => dir !== '.');
}

function affinity(a: Group, b: Group): number {
  const areas = shared(
    a.tasks.flatMap((task) => task.areas),
    b.tasks.flatMap((task) => task.areas),
  );
  const adjacent = a.last + 1 === b.first || b.last + 1 === a.first ? 1 : 0;
  return areas * 2 + shared(folders(a), folders(b)) + adjacent;
}

function joined(a: Group, b: Group): Group {
  return {
    tasks: [...a.tasks, ...b.tasks],
    first: Math.min(a.first, b.first),
    last: Math.max(a.last, b.last),
  };
}

function joinDependent(groups: Group[]): Group[] {
  const result = [...groups];
  for (let a = 0; a < result.length; a += 1) {
    for (let b = a + 1; b < result.length; b += 1) {
      if (!joinable(result[a]!, result[b]!)) continue;
      if (shared(filesOf(result[a]!), filesOf(result[b]!)) === 0) continue;
      result[a] = joined(result[a]!, result[b]!);
      result.splice(b, 1);
      b = a;
    }
  }
  return result;
}

function closestPair(groups: readonly Group[]): [number, number] | null {
  let best: [number, number] | null = null;
  let bestScore = -1;
  for (let a = 0; a < groups.length; a += 1) {
    for (let b = a + 1; b < groups.length; b += 1) {
      if (!joinable(groups[a]!, groups[b]!)) continue;
      const score = affinity(groups[a]!, groups[b]!);
      if (score > bestScore) {
        best = [a, b];
        bestScore = score;
      }
    }
  }
  return best;
}

export function groupTasks(tasks: readonly GroupTask[], count: number): string[][] {
  let groups = joinDependent(
    tasks.map((task, index) => ({ tasks: [task], first: index, last: index })),
  );
  while (groups.length > count) {
    const pair = closestPair(groups);
    if (!pair) break;
    const [a, b] = pair;
    groups = groups.flatMap((group, index) =>
      index === a ? [joined(group, groups[b]!)] : index === b ? [] : [group],
    );
  }
  const order = new Map(tasks.map((task, index) => [task.key, index]));
  return groups
    .sort((a, b) => a.first - b.first)
    .map((group) =>
      group.tasks.map((task) => task.key).sort((a, b) => order.get(a)! - order.get(b)!),
    );
}

function stronger(a: ScoreSignal | null, b: ScoreSignal | null): ScoreSignal | null {
  if (!a || !b) return a ?? b;
  return b.mean > a.mean ? b : a;
}

function higher(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return a ?? b;
  return Math.max(a, b);
}

function simpleKind(choice: string): boolean {
  return (PIECE_BELOW_CHAT_KINDS as readonly string[]).includes(choice);
}

function foldKind(a: PieceAnswer['kind'], b: PieceAnswer['kind']): PieceAnswer['kind'] {
  if (typeof a === 'string') return b;
  if (typeof b === 'string') return a;
  if (a.choice === b.choice) return a.confidence <= b.confidence ? a : b;
  if (b.choice === 'migrate') return b;
  if (a.choice === 'migrate') return a;
  return simpleKind(a.choice) ? b : a;
}

export function foldAnswer(a: PieceAnswer, b: PieceAnswer): PieceAnswer {
  return {
    kind: foldKind(a.kind, b.kind),
    reasoning: stronger(a.reasoning, b.reasoning),
    coding: stronger(a.coding, b.coding),
    context: stronger(a.context, b.context),
    reliability: higher(a.reliability, b.reliability),
    wide: higher(a.wide, b.wide),
  };
}

export function groupAnswer(
  keys: readonly string[],
  answers: ReadonlyMap<string, PieceAnswer>,
): PieceAnswer | null {
  const found = keys.flatMap((key) => answers.get(key) ?? []);
  if (found.length === 0) return null;
  return found.reduce(foldAnswer);
}
