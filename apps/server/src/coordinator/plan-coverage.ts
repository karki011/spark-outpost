import path from 'node:path';
import { namedFiles } from '../orchestration/context.ts';
import { owns, type OwnedSet } from './owned.ts';

export interface PlanStep {
  text: string;
  files: string[];
}

export interface CoveringPiece {
  title: string;
  goal: string;
  acceptance: readonly string[];
  owns: readonly string[];
  reads: readonly string[];
  contract: string | null;
  owned: OwnedSet;
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const LIST_ITEM = /^(\s*)(?:\d+[.)]|[-*+])\s+(?:\[( |x|X)\]\s+)?(.*)$/;
const DECISION_HEADING =
  /\b(decision|decisions|approach|design|trade-?offs?|notes?|constraints?)\b/i;
const VERIFY_HEADING =
  /^\W*(?:\d+[.)]\s*)?(?:verification|verify|testing plan|how to test|manual (?:checks?|tests?))\b/i;
const VERIFY_STEP =
  /^\W*(?:re-?)?(?:run|verify|confirm|manually|sanity[- ]check|spot[- ]check|smoke[- ]test|double[- ]check|exercise|try it)\b/i;
const WORD = /[a-z][a-z0-9]{3,}/g;

interface Parent {
  indent: number;
  files: string[];
  step: PlanStep | null;
}

function filesIn(text: string): string[] {
  return namedFiles([text]).map((file) => file.replace(/^\.\//, ''));
}

function isVerification(heading: string, text: string): boolean {
  return VERIFY_HEADING.test(heading) || VERIFY_STEP.test(text);
}

export function planSteps(body: string): PlanStep[] {
  const steps: PlanStep[] = [];
  const grouping = new Set<PlanStep>();
  let fenced = false;
  let heading = '';
  let headingFiles: string[] = [];
  let parents: Parent[] = [];
  for (const line of body.split('\n')) {
    if (FENCE.test(line)) fenced = !fenced;
    if (fenced || FENCE.test(line)) continue;
    const found = HEADING.exec(line);
    if (found) {
      heading = found[1]!;
      headingFiles = filesIn(heading);
      parents = [];
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (!item || DECISION_HEADING.test(heading)) continue;
    const indent = item[1]!.length;
    const text = item[3]!.replace(/\s+/g, ' ').trim();
    parents = parents.filter((parent) => parent.indent < indent);
    const parent = parents.at(-1);
    if (parent?.step) grouping.add(parent.step);
    const own = filesIn(text);
    const inherited = parents.flatMap((entry) => entry.files);
    const open = text !== '' && item[2]?.toLowerCase() !== 'x' && !isVerification(heading, text);
    const step = open
      ? { text, files: [...new Set([...own, ...inherited, ...headingFiles])] }
      : null;
    if (step) steps.push(step);
    parents.push({ indent, files: [...own, ...inherited], step });
  }
  return steps.filter((step) => !grouping.has(step));
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(WORD) ?? []);
}

function claims(piece: CoveringPiece, file: string): boolean {
  if (owns(piece.owned, file) || piece.reads.includes(file)) return true;
  if (file.includes('/')) return false;
  const named = [...piece.owned.paths, ...piece.reads];
  return named.some((owned) => path.basename(owned) === file);
}

function byWords(text: string, pieces: readonly CoveringPiece[]): boolean {
  const wanted = [...words(text)];
  if (wanted.length === 0) return true;
  return pieces.some((piece) => {
    const known = words(
      [piece.title, piece.goal, ...piece.acceptance, ...piece.owns, piece.contract ?? ''].join(' '),
    );
    return wanted.filter((word) => known.has(word)).length * 2 >= wanted.length;
  });
}

export function coveredBy(step: PlanStep, pieces: readonly CoveringPiece[]): boolean {
  if (step.files.some((file) => pieces.some((piece) => claims(piece, file)))) return true;
  return byWords(step.text, pieces);
}

export function uncoveredSteps(
  steps: readonly PlanStep[],
  pieces: readonly CoveringPiece[],
): PlanStep[] {
  return steps.filter((step) => !coveredBy(step, pieces));
}
