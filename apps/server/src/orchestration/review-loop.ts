import type { ReviewVerdict } from '@spark-outpost/contracts';
import { CRITIC_FIX_ROUNDS } from '../advisor/policy.ts';

export type ReviewAction = 'fix' | 'clean' | 'unclear' | 'repeated' | 'cap';
export type ReviewStop = 'clean' | 'unclear' | 'repeated' | 'cap' | 'checks_failing';

export interface ReviewRound {
  review: number;
  findings: string[];
  action: ReviewAction;
}

export interface ReviewLoop {
  rounds: ReviewRound[];
  fixRounds: number;
  fixing: boolean;
  fixable: string[];
  stop: ReviewStop | null;
}

export const IDLE_REVIEW: ReviewLoop = {
  rounds: [],
  fixRounds: 0,
  fixing: false,
  fixable: [],
  stop: null,
};

const LINE_REF = /:\d+(?::\d+)?\b|\bL\d+\b/g;
const KIND_TAG = /^\W*\[\w+\]/;

export function normalizeFinding(finding: string): string {
  return finding
    .replace(KIND_TAG, '')
    .replace(LINE_REF, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}$+-]+/gu, ' ')
    .trim();
}

export function repeatsPrevious(previous: readonly string[], current: readonly string[]): boolean {
  if (current.length === 0 || previous.length === 0) return false;
  const seen = new Set(previous.map(normalizeFinding));
  return current.some((finding) => seen.has(normalizeFinding(finding)));
}

export function reviewAction(
  loop: ReviewLoop,
  verdict: ReviewVerdict,
  fixable: readonly string[],
): ReviewAction {
  if (verdict === 'unclear') return 'unclear';
  if (fixable.length === 0) return 'clean';
  const previous = loop.rounds.flatMap((round) => round.findings);
  if (loop.fixRounds > 0 && repeatsPrevious(previous, fixable)) return 'repeated';
  if (loop.fixRounds >= CRITIC_FIX_ROUNDS) return 'cap';
  return 'fix';
}

function stopFor(action: ReviewAction, fixRounds: number): ReviewStop | null {
  if (action === 'fix') return null;
  if (action === 'clean' || action === 'unclear') return fixRounds > 0 ? action : null;
  return action;
}

export function afterReview(
  loop: ReviewLoop,
  verdict: ReviewVerdict,
  fixable: readonly string[],
): ReviewLoop {
  const action = reviewAction(loop, verdict, fixable);
  const kept = action === 'unclear' ? [] : [...fixable];
  return {
    ...loop,
    fixing: false,
    fixable: kept,
    stop: stopFor(action, loop.fixRounds),
    rounds: [...loop.rounds, { review: loop.rounds.length + 1, findings: kept, action }],
  };
}

export function startFix(loop: ReviewLoop): ReviewLoop {
  return { ...loop, fixRounds: loop.fixRounds + 1, fixing: true, stop: null };
}

export function checksFailedAfterFix(loop: ReviewLoop): ReviewLoop {
  return { ...loop, fixing: false, stop: 'checks_failing' };
}

export function lastAction(loop: ReviewLoop): ReviewAction | null {
  return loop.rounds.at(-1)?.action ?? null;
}

export function canFixAgain(loop: ReviewLoop): boolean {
  return loop.fixable.length > 0 && !loop.fixing;
}

export function fixOptionLabel(loop: ReviewLoop): string | null {
  if (!canFixAgain(loop)) return null;
  return loop.fixRounds === 0 ? 'Fix these findings' : 'Fix again';
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

const SHOWN_FINDINGS = 3;
const FINDING_CHARACTERS = 160;

export function findingList(findings: readonly string[]): string {
  const shown = findings.slice(0, SHOWN_FINDINGS).map((finding) => {
    const trimmed = finding.trim();
    return trimmed.length > FINDING_CHARACTERS
      ? `${trimmed.slice(0, FINDING_CHARACTERS)}…`
      : trimmed;
  });
  const more =
    findings.length > SHOWN_FINDINGS ? ` and ${findings.length - SHOWN_FINDINGS} more` : '';
  return `${shown.join('; ')}${more}`;
}

export function reviewLine(loop: ReviewLoop, checks: string): string | null {
  const rounds = counted(loop.fixRounds, 'round');
  if (loop.fixing) {
    return `${counted(loop.fixRounds, 'fix round')} ran for the AI review's findings; the Critic did not review the last fix; ${checks}.`;
  }
  switch (loop.stop) {
    case 'clean':
      return `Fixed after ${counted(loop.fixRounds, 'review round')}: the Critic's last review found no correctness problems; ${checks}.`;
    case 'unclear':
      return `After ${rounds} of fixes the Critic gave no clear verdict on the last fix; ${checks}.`;
    case 'repeated':
      return `Still concerns after ${rounds}: the same findings came back after the fix: ${findingList(loop.fixable)}; ${checks}.`;
    case 'cap':
      return `Still concerns after ${rounds}: ${findingList(loop.fixable)}; ${checks}.`;
    case 'checks_failing':
      return `Stopped after ${counted(loop.fixRounds, 'fix round')}: the checks failed after the fix and the check-fix turns could not fix them.`;
    case null:
      break;
  }
  if (loop.fixable.length === 0) return null;
  if (loop.fixRounds === 0) {
    return `The AI review found ${counted(loop.fixable.length, 'correctness finding')}.`;
  }
  return `Still concerns after ${rounds}: ${findingList(loop.fixable)}; ${checks}.`;
}
