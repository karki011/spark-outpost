import { COORD_BUILDER_BUDGET_CAP, COORD_BUILDER_BUDGET_SHARE } from '../advisor/policy.ts';

export const TOKENS_PER_LINE = 12;
const BASE_TOKENS = 12_000;
const TOKENS_PER_OWNED_FILE = 6_000;

export type LineCount = (path: string) => number | null;

export interface SizedWork {
  owns: readonly string[];
  reads: readonly string[];
}

function fileTokens(paths: readonly string[], lines: LineCount): number {
  return paths.reduce((total, path) => total + (lines(path) ?? 0) * TOKENS_PER_LINE, 0);
}

export function sizeEstimate(work: SizedWork, lines: LineCount): number {
  return (
    BASE_TOKENS +
    2 * fileTokens(work.owns, lines) +
    fileTokens(work.reads, lines) +
    TOKENS_PER_OWNED_FILE * work.owns.length
  );
}

export function builderBudget(contextSize: number | null): number {
  if (contextSize === null) return COORD_BUILDER_BUDGET_CAP;
  return Math.min(Math.floor(contextSize * COORD_BUILDER_BUDGET_SHARE), COORD_BUILDER_BUDGET_CAP);
}
