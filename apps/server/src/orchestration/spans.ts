import { isResearchStep } from './parallel.ts';

export interface Spanned {
  stepIndex: number;
  carry?: readonly number[] | undefined;
}

export function spanOf(spawn: Spanned): number[] {
  return spawn.carry && spawn.carry.length > 0 ? [...spawn.carry] : [spawn.stepIndex];
}

function inGroup(groups: readonly (readonly number[])[], index: number): boolean {
  return groups.some((group) => group.includes(index));
}

export function carriedSteps(
  steps: readonly string[],
  groups: readonly (readonly number[])[],
  completed: readonly number[],
  stepIndex: number,
): number[] {
  const span = [stepIndex];
  if (inGroup(groups, stepIndex) || isResearchStep(steps[stepIndex] ?? '')) return span;
  for (let index = stepIndex + 1; index < steps.length; index += 1) {
    if (completed.includes(index) || inGroup(groups, index)) break;
    if (isResearchStep(steps[index] ?? '')) break;
    span.push(index);
  }
  return span;
}

export function builderSpans(
  steps: readonly string[],
  groups: readonly (readonly number[])[],
): number[][] {
  const spans: number[][] = [];
  let index = 0;
  while (index < steps.length) {
    const span = carriedSteps(steps, groups, [], index);
    spans.push(span);
    index = span.at(-1)! + 1;
  }
  return spans;
}

export function openSpan(
  spawn: Spanned,
  completed: readonly number[],
): { stepIndex: number; carry: number[] | undefined } {
  const open = spanOf(spawn).filter((index) => !completed.includes(index));
  return { stepIndex: open[0] ?? spawn.stepIndex, carry: open.length > 1 ? open : undefined };
}
