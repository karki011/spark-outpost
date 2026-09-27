import { namedFiles } from './context.ts';
import type { NoulVerdict } from './parallel-choice.ts';
import { isResearchStep, worthItsOwnBuilder } from './parallel.ts';
import { dependsOn, stepFiles } from './step-files.ts';

export const MAX_CHAIN_STEPS = 12;
export const LARGE_LANE_STEPS = 2;
export const LARGE_LANE_FILES = 5;

export interface StepNotes {
  files: (string[] | null)[];
  depends: (number[] | null)[];
}

const STEP_LINE = /^[\s*_>#-]*(?:step\s*(\d{1,2})\s*[.):·—–|-]?|(\d{1,2})\s*[.):·—–|])\s*(.*)$/i;
const FILES_PART = /\bfiles?\s*:\s*(.+?)\s*(?=[·|;]|\bdepends\b|$)/i;
const DEPENDS_PART = /\bdepends\s+on\s*:?\s*(.+?)\s*(?=[·|;]|\bfiles?\s*:|$)/i;
const NOTHING = /^(?:none|nothing|-|n\/a|no\b.*)\.?$/i;
const CHAIN_LINE = /^[\s*_>#-]*chain\s+[\w-]+[^:\n]*:\s*(.+)$/gim;

function numbers(text: string, count: number): number[] {
  const found: number[] = [];
  for (const match of text.matchAll(/(\d{1,2})\s*(?:[-–]|to)\s*(\d{1,2})|(\d{1,2})/g)) {
    if (match[3] !== undefined) found.push(Number(match[3]) - 1);
    else {
      const from = Number(match[1]) - 1;
      const to = Number(match[2]) - 1;
      for (let index = from; index <= to; index += 1) found.push(index);
    }
  }
  return [...new Set(found.filter((index) => index >= 0 && index < count))].sort((a, b) => a - b);
}

function filesIn(part: string): string[] {
  if (NOTHING.test(part.trim())) return [];
  return namedFiles([part.replace(/[,`]/g, ' ')]).map((file) => file.replace(/^\.\//, ''));
}

export function stepNotesFromReply(text: string, count: number): StepNotes {
  const notes: StepNotes = {
    files: Array.from({ length: count }, () => null),
    depends: Array.from({ length: count }, () => null),
  };
  for (const line of text.split('\n')) {
    const match = STEP_LINE.exec(line);
    if (!match) continue;
    const index = Number(match[1] ?? match[2]) - 1;
    if (index < 0 || index >= count) continue;
    const rest = match[3] ?? '';
    const files = FILES_PART.exec(rest)?.[1];
    if (files !== undefined && notes.files[index] === null) notes.files[index] = filesIn(files);
    const depends = DEPENDS_PART.exec(rest)?.[1];
    if (depends !== undefined && notes.depends[index] === null) {
      notes.depends[index] = NOTHING.test(depends.trim())
        ? []
        : numbers(depends, count).filter((earlier) => earlier < index);
    }
  }
  return notes;
}

const PARALLEL_CHAINS_LINE = /^[\s*_#>-]*parallel chains[\s*_]*:[\s*_]*(yes|no)\b/im;

export function parallelChainsFromReply(text: string): boolean | null {
  const answer = PARALLEL_CHAINS_LINE.exec(text)?.[1];
  return answer === undefined ? null : answer.toLowerCase() === 'yes';
}

export function chainsFromReply(text: string, count: number): number[][] {
  const chains: number[][] = [];
  for (const match of text.matchAll(CHAIN_LINE)) {
    const steps = numbers(match[1] ?? '', count).filter(
      (index) => !chains.some((chain) => chain.includes(index)),
    );
    if (steps.length > 0) chains.push(steps);
  }
  return chains.length > 1 ? chains : [];
}

export function architectChains(
  text: string,
  count: number,
  depends: readonly (number[] | null)[],
): { chains: number[][]; depends: readonly (number[] | null)[]; parallel: boolean | null } {
  return { chains: chainsFromReply(text, count), depends, parallel: parallelChainsFromReply(text) };
}

export function withFilesLines(steps: readonly string[], notes: StepNotes): string[] {
  return steps.map((step, index) => {
    const files = notes.files[index];
    if (files === null || files === undefined || /(?:^|\s)files\s*:/im.test(step)) return step;
    return `${step}\nFiles: ${files.length > 0 ? files.join(', ') : 'none'}`;
  });
}

export function dependencies(
  count: number,
  chains: readonly (readonly number[])[],
  depends: readonly (number[] | null)[],
): number[][] | null {
  const hasChains = chains.length > 1;
  const hasDepends = depends.some((entry) => entry !== null);
  if (!hasChains && !hasDepends) return null;
  return Array.from({ length: count }, (_, index) => {
    const stated = depends[index];
    if (stated !== null && stated !== undefined) return stated;
    if (hasChains) {
      const chain = chains.find((candidate) => candidate.includes(index));
      if (!chain) return Array.from({ length: index }, (_, earlier) => earlier);
      const position = chain.indexOf(index);
      return position > 0 ? [chain[position - 1]!] : [];
    }
    return index > 0 ? [index - 1] : [];
  });
}

function components(members: readonly number[], links: (a: number, b: number) => boolean) {
  const owner = new Map(members.map((member) => [member, member]));
  const find = (member: number): number => {
    const parent = owner.get(member)!;
    if (parent === member) return member;
    const root = find(parent);
    owner.set(member, root);
    return root;
  };
  for (const a of members) {
    for (const b of members) {
      if (a < b && links(a, b)) owner.set(find(b), find(a));
    }
  }
  const groups = new Map<number, number[]>();
  for (const member of members) {
    const root = find(member);
    groups.set(root, [...(groups.get(root) ?? []), member]);
  }
  return [...groups.values()].sort((a, b) => a[0]! - b[0]!);
}

export function lanesFromDependencies(depends: readonly (readonly number[])[]): number[][] {
  const count = depends.length;
  const linked = (a: number, b: number) => depends[b]!.includes(a) || depends[a]!.includes(b);
  for (let outside = 0; outside <= count - 2; outside += 1) {
    for (let before = 0; before <= outside; before += 1) {
      const middle = Array.from({ length: count - outside }, (_, offset) => before + offset);
      const lanes = components(middle, linked);
      if (lanes.length > 1) return lanes;
    }
  }
  return [];
}

function mergeLanes(
  lanes: readonly number[][],
  shouldMerge: (a: number[], b: number[]) => boolean,
) {
  const result = lanes.map((lane) => [...lane]);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let a = 0; a < result.length; a += 1) {
      for (let b = a + 1; b < result.length; b += 1) {
        if (!shouldMerge(result[a]!, result[b]!)) continue;
        result[a] = [...result[a]!, ...result[b]!].sort((x, y) => x - y);
        result.splice(b, 1);
        merged = true;
        break outer;
      }
    }
  }
  return result.sort((a, b) => a[0]! - b[0]!);
}

export interface LaneInputs {
  steps: readonly string[];
  chains: readonly (readonly number[])[];
  depends: readonly (number[] | null)[];
  large: readonly number[];
  independent?: readonly (NoulVerdict | null)[];
  sizes?: readonly (NoulVerdict | null)[];
  split?: 'large' | 'any';
}

function touchesOther(steps: readonly string[], a: readonly number[], b: readonly number[]) {
  const files = (index: number) => stepFiles(steps[index] ?? '');
  return a.some((left) => b.some((right) => dependsOn(files(left), files(right))));
}

function jevSaysLinked(
  independent: readonly (NoulVerdict | null)[],
  a: readonly number[],
  b: readonly number[],
) {
  return independent.some((verdict, index) => {
    if (verdict?.value !== false) return false;
    const pair = [index, index + 1];
    return pair.some((step) => a.includes(step)) && pair.some((step) => b.includes(step));
  });
}

function stepWorth(inputs: LaneInputs, index: number): boolean {
  const jev = inputs.sizes?.[index]?.value ?? null;
  if (jev !== null && !isResearchStep(inputs.steps[index] ?? '')) return jev;
  return worthItsOwnBuilder(inputs.steps[index] ?? '', index, inputs.large);
}

function stepLarge(inputs: LaneInputs, index: number): boolean {
  const jev = inputs.sizes?.[index]?.value ?? null;
  return jev ?? inputs.large.includes(index);
}

function laneFiles(steps: readonly string[], lane: readonly number[]): number {
  return new Set(lane.flatMap((index) => stepFiles(steps[index] ?? '').changes)).size;
}

export function largeLane(inputs: LaneInputs, lane: readonly number[]): boolean {
  const large = lane.filter((index) => stepLarge(inputs, index)).length;
  if (large >= Math.min(LARGE_LANE_STEPS, lane.length)) return true;
  return laneFiles(inputs.steps, lane) >= LARGE_LANE_FILES;
}

function worthALane(inputs: LaneInputs, lane: readonly number[]): boolean {
  if (inputs.split !== 'any') return largeLane(inputs, lane);
  if (lane.length > 1) return true;
  return lane.some((index) => stepWorth(inputs, index));
}

export function chooseLanes(inputs: LaneInputs): number[][] {
  const count = inputs.steps.length;
  if (count < 2 || count > MAX_CHAIN_STEPS) return [];
  const depends = dependencies(count, inputs.chains, inputs.depends);
  if (!depends) return [];
  const research = inputs.steps.some((step) => isResearchStep(step));
  if (research) return [];
  const safe = mergeLanes(
    lanesFromDependencies(depends),
    (a, b) =>
      touchesOther(inputs.steps, a, b) ||
      touchesOther(inputs.steps, b, a) ||
      jevSaysLinked(inputs.independent ?? [], a, b),
  );
  const worth = mergeLanes(safe, (a, b) => !worthALane(inputs, a) || !worthALane(inputs, b));
  return worth.length > 1 ? worth : [];
}
