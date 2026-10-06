import type { Coordination } from '../coordinator/state.ts';
import { sourceFiles } from './critic-rule.ts';
import { changesForReview } from './member-prompts.ts';
import type { DiffFile } from './risk-rules.ts';
import type { MemberResult, Session } from './session.ts';

const RECHECK_FILES = 3;
const RECHECK_MIN_SOURCE_FILES = 2;

export interface RecheckFacts {
  toolCalls: number;
  files: readonly DiffFile[];
  stakesFiles: ReadonlySet<string>;
  destructive: boolean;
}

function size(file: DiffFile): number {
  return file.additions + file.deletions;
}

export function riskiestFiles(facts: RecheckFacts): string[] | null {
  if (facts.toolCalls > 0 || facts.files.length === 0) return null;
  const source = sourceFiles(facts.files);
  const stakes = facts.destructive || facts.files.some((file) => facts.stakesFiles.has(file.path));
  if (source.length < RECHECK_MIN_SOURCE_FILES && !stakes) return null;
  const pool = source.length > 0 ? source : facts.files;
  const risk = (file: DiffFile) => (facts.stakesFiles.has(file.path) ? 1 : 0);
  return [...pool]
    .sort((a, b) => risk(b) - risk(a) || size(b) - size(a))
    .slice(0, RECHECK_FILES)
    .map((file) => file.path);
}

export function recheckFollowUp(paths: readonly string[]): string {
  const named = paths.map((path) => `\`${path}\``).join(', ');
  return [
    `You replied without opening any of the changed files. Open ${named} now and re-check their edge cases against the request before you settle the verdict.`,
    'Then reply again in full: list every finding in the same format and end with the Verdict line.',
  ].join(' ');
}

export function stakesFiles(coordination: Coordination | null | undefined): Set<string> {
  const top = coordination?.topTier ?? new Set<string>();
  const pieces = (coordination?.list?.pieces ?? []).filter((piece) => top.has(piece.key));
  return new Set(pieces.flatMap((piece) => [...piece.owns, ...piece.filesChanged]));
}

export async function blindReview(s: Session, result: MemberResult): Promise<string | null> {
  if (result.outcome !== 'succeeded' || result.toolCalls > 0) return null;
  const changes = await changesForReview(s).catch(() => null);
  if (!changes) return null;
  const paths = riskiestFiles({
    toolCalls: result.toolCalls,
    files: changes.files,
    stakesFiles: stakesFiles(s.coordination),
    destructive: s.facts.destructive,
  });
  return paths ? recheckFollowUp(paths) : null;
}
