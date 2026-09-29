import { redactText } from '../audit/redact.ts';
import { fitEvidence, namedSymbolsLines } from '../codescan/jev-state.ts';
import type { RankedFile } from '../codescan/rank.ts';
import type { ScanReport } from '../codescan/scan.ts';

export const REQUEST_CHARACTERS = 4_000;
export const CHECK_CHARACTERS = 1_000;
export const TURN_CHARACTERS = 600;
export const PRIOR_TURNS = 2;
export const EVIDENCE_TOKENS = 1_500;
const HEAD_SHARE = 0.6;
const GAP = '\n[…]\n';

export interface PriorTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface RouteInputs {
  request: string;
  priorTurns: readonly PriorTurn[];
  lastFailingCheck: string | null;
  evidence: string | null;
}

export type RouteVariant = 'text' | 'evidence';

export function headAndTail(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.ceil(max * HEAD_SHARE);
  return `${text.slice(0, head)}${GAP}${text.slice(text.length - (max - head))}`;
}

export function redactedExcerpt(text: string, max: number): string {
  return headAndTail(redactText(text).trim(), max);
}

export function routeState(facts: RouteInputs, variant: RouteVariant): Record<string, unknown> {
  const state: Record<string, unknown> = {
    request: redactedExcerpt(facts.request, REQUEST_CHARACTERS),
  };
  if (variant === 'evidence' && facts.evidence) state.code_evidence = facts.evidence;
  if (facts.lastFailingCheck) {
    state.last_failing_check = redactedExcerpt(facts.lastFailingCheck, CHECK_CHARACTERS);
  }
  const turns = facts.priorTurns.slice(-PRIOR_TURNS);
  if (turns.length > 0) {
    state.prior_turns = turns.map((turn) => ({
      role: turn.role,
      text: redactedExcerpt(turn.content, TURN_CHARACTERS),
    }));
  }
  return state;
}

function evidenceFacts(report: ScanReport, files: readonly RankedFile[]): string[] {
  const packages = [...new Set(files.map((file) => file.package))];
  return [
    `Packages touched by the likely files (${packages.length}): ${packages.join(', ')}`,
    ...namedSymbolsLines(report.summary),
    `Uncommitted files in the repository: ${report.summary.uncommitted}.`,
    'Files most likely to change, most likely first (path | lines | symbols | referenced by | churn | package | why):',
  ];
}

export function evidenceText(
  report: ScanReport,
  files: readonly RankedFile[],
  budget: number = EVIDENCE_TOKENS,
): string {
  return fitEvidence(evidenceFacts(report, files), files, budget).text;
}
