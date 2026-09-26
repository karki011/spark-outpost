import { changedCount, dependsOn, stepFiles, type StepFiles } from './step-files.ts';

const PARALLEL_TAG = /[[(]parallel[\s:-]+([\w-]+)[\])][.\s]*$/i;
const RESEARCH_PREFIX = /^\s*research\s*:/i;

function lines(step: string): string[] {
  return step
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parallelTag(step: string): string | null {
  const tags = lines(step).map((line) => PARALLEL_TAG.exec(line)?.[1]?.toLowerCase() ?? null);
  const first = tags[0] ?? null;
  return first !== null && tags.every((tag) => tag === first) ? first : null;
}

export function isResearchStep(step: string): boolean {
  const parts = lines(step);
  return parts.length > 0 && parts.every((line) => RESEARCH_PREFIX.test(line));
}

export function splitByFiles(indexes: readonly number[], steps: readonly string[]): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];
  let files: StepFiles[] = [];
  for (const index of indexes) {
    const own = stepFiles(steps[index]!);
    if (current.length > 0 && files.some((other) => dependsOn(other, own))) {
      groups.push(current);
      current = [];
      files = [];
    }
    current.push(index);
    files.push(own);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

const PARALLEL_LINE = /^[\s*_#>-]*parallel[\s*_]*:[\s*_]*(.+)$/im;

function consecutive(indexes: readonly number[]): boolean {
  return indexes.every((index, position) => position === 0 || index === indexes[position - 1]! + 1);
}

export function parallelFromReply(text: string, count: number): number[][] {
  const line = PARALLEL_LINE.exec(text)?.[1];
  if (!line) return [];
  return line
    .split(';')
    .map((part) => {
      const numbers = [...part.matchAll(/\d+/g)].map((match) => Number(match[0]) - 1);
      return [...new Set(numbers.filter((index) => index >= 0 && index < count))].sort(
        (a, b) => a - b,
      );
    })
    .filter((group) => group.length > 1 && consecutive(group));
}

const LARGE_LINE = /^[\s*_#>-]*large[\s*_]*:[\s*_]*(.+)$/im;
export const WORTH_SPLITTING_FILES = 2;

export function largeFromReply(text: string, count: number): number[] {
  const line = LARGE_LINE.exec(text)?.[1];
  if (!line) return [];
  const numbers = [...line.matchAll(/\d+/g)].map((match) => Number(match[0]) - 1);
  return [...new Set(numbers.filter((index) => index >= 0 && index < count))].sort((a, b) => a - b);
}

export function worthItsOwnBuilder(step: string, index: number, large: readonly number[]): boolean {
  if (isResearchStep(step)) return true;
  return large.includes(index) || changedCount(step) >= WORTH_SPLITTING_FILES;
}

export function worthSplitting(
  groups: readonly (readonly number[])[],
  steps: readonly string[],
  large: readonly number[],
): number[][] {
  return groups
    .filter((group) => group.every((index) => worthItsOwnBuilder(steps[index] ?? '', index, large)))
    .map((group) => [...group]);
}

export function planGroups(steps: readonly string[], hinted: readonly number[][]): number[][] {
  const groups = hinted.length > 0 ? hinted : parallelGroups(steps);
  return groups.flatMap((group) => splitByFiles(group, steps)).filter((group) => group.length > 1);
}

export function batchGroups(
  groups: readonly (readonly number[])[],
  ranges: readonly (readonly number[])[],
): number[][] {
  const owner = (entry: number) => groups.findIndex((group) => group.includes(entry));
  const batchOwner = ranges.map((range) => {
    const owners = range.map(owner);
    return owners.every((id) => id >= 0 && id === owners[0]) ? owners[0]! : -1;
  });
  const result: number[][] = [];
  batchOwner.forEach((id, batch) => {
    const last = result.at(-1);
    if (id >= 0 && last && batchOwner[last.at(-1)!] === id) last.push(batch);
    else result.push([batch]);
  });
  return result.filter((group) => group.length > 1 && batchOwner[group[0]!]! >= 0);
}

export function parallelGroups(steps: readonly string[]): number[][] {
  const runs: number[][] = [];
  let previous: string | null = null;
  steps.forEach((step, index) => {
    const tag = parallelTag(step);
    if (tag !== null && tag === previous) runs.at(-1)!.push(index);
    else runs.push([index]);
    previous = tag;
  });
  return runs
    .filter((run) => run.length > 1)
    .flatMap((run) => splitByFiles(run, steps))
    .filter((group) => group.length > 1);
}

export function groupMembers(
  groups: readonly (readonly number[])[],
  completed: readonly number[],
  steps: readonly string[],
  index: number,
  worktrees: boolean,
): number[] {
  const group = groups.find((candidate) => candidate.includes(index)) ?? [index];
  const open = group.filter((member) => member >= index && !completed.includes(member));
  if (worktrees) return open;
  const builders = open.filter((member) => !isResearchStep(steps[member] ?? ''));
  return open.filter((member) => member === builders[0] || !builders.includes(member));
}

export function nextOpenStep(
  steps: readonly string[],
  completed: readonly number[],
  after: number,
): number | null {
  for (let index = after + 1; index < steps.length; index += 1) {
    if (!completed.includes(index)) return index;
  }
  return null;
}

export function sequentialReason(groups: readonly (readonly number[])[], steps: readonly string[]) {
  const builders = groups.some(
    (group) => group.filter((index) => !isResearchStep(steps[index] ?? '')).length > 1,
  );
  return builders
    ? 'The plan had steps that could run in parallel, but the project is not a git repository, so one Builder did them in order.'
    : null;
}

export function conflictLine(first: string, second: string, files: readonly string[]): string {
  const shown = files[0] ?? 'the same file';
  const more = files.length > 1 ? ` and ${files.length - 1} more` : '';
  return `${first} and ${second} both changed ${shown}${more}.`;
}

export const MAX_BUILDERS = 4;

export function batchRanges(count: number, max = MAX_BUILDERS): number[][] {
  const size = count <= max ? 1 : Math.ceil(count / max);
  const batches: number[][] = [];
  for (let start = 0; start < count; start += size) {
    const end = Math.min(start + size, count);
    batches.push(Array.from({ length: end - start }, (_, offset) => start + offset));
  }
  return batches;
}

export function batchSteps(steps: readonly string[], max = MAX_BUILDERS): string[] {
  const kept = steps.map((step) => step.trim()).filter(Boolean);
  return batchRanges(kept.length, max).map((batch) => batch.map((index) => kept[index]).join('\n'));
}
