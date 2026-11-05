import type { PrCheckRun, PrDetails, PrWatch } from '@spark-outpost/contracts';
import { ciState, PULL_STATE_LABELS, pullState } from './pull-request-model.ts';

export type FactTone = 'bad' | 'prog' | 'warn' | 'plain';

export interface RowFact {
  key: string;
  text: string;
  tone: FactTone;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function needYou(watch: Pick<PrWatch, 'items'>): number {
  return watch.items.filter((item) => item.state === 'needs_user').length;
}

const IN_ROUND: ReadonlySet<PrWatch['phase']> = new Set(['fixing', 'confirming']);

export function rowFacts(watch: PrWatch): RowFact[] {
  if (watch.prState !== 'open') return [];
  const facts: RowFact[] = [];
  const ci = ciState(watch);
  if (ci === 'failing') facts.push({ key: 'ci', text: 'Checks failing', tone: 'bad' });
  if (ci === 'pending') facts.push({ key: 'ci', text: 'Checks running', tone: 'prog' });
  const waiting = needYou(watch);
  if (waiting > 0) facts.push({ key: 'need', text: `${waiting} need you`, tone: 'warn' });
  if (watch.newComments > 0) {
    facts.push({
      key: 'comments',
      text: plural(watch.newComments, 'new comment', 'new comments'),
      tone: 'plain',
    });
  }
  if (IN_ROUND.has(watch.phase) && watch.rounds > 0) {
    facts.push({
      key: 'round',
      text: `Round ${watch.rounds} of ${watch.maxRounds}`,
      tone: 'plain',
    });
  }
  return facts;
}

export function rowSummary(watch: PrWatch): string {
  const parts = [PULL_STATE_LABELS[pullState(watch)], ...rowFacts(watch).map((fact) => fact.text)];
  return `Pull request #${watch.number}: ${parts.join(', ')}`;
}

export const dismissKey = (watch: Pick<PrWatch, 'id' | 'prState'>) =>
  `${watch.id}:${watch.prState}`;

export function shownPulls(watches: readonly PrWatch[], dismissed: ReadonlySet<string>): PrWatch[] {
  return watches
    .filter((watch) => watch.prState === 'open' || !dismissed.has(dismissKey(watch)))
    .toSorted((a, b) => b.opened.at.localeCompare(a.opened.at) || b.number - a.number);
}

export const GROUP_OVER = 2;

export function groupLine(watches: readonly PrWatch[]): string {
  const open = watches.filter((watch) => watch.prState === 'open').length;
  const failing = watches.filter(
    (watch) => watch.prState === 'open' && ciState(watch) === 'failing',
  ).length;
  const waiting = watches.reduce((sum, watch) => sum + needYou(watch), 0);
  return [
    open > 0 ? `${open} open` : null,
    failing > 0 ? `${failing} failing` : null,
    waiting > 0 ? `${waiting} need you` : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

export function checkRuns(watch: Pick<PrWatch, 'details' | 'failingChecks'>): PrCheckRun[] {
  if (watch.details.checkRuns.length > 0) return watch.details.checkRuns;
  return watch.failingChecks.map((check) => ({ ...check, state: 'failing', summary: null }));
}

const CHECK_WORDS: Record<Exclude<PrCheckRun['state'], 'failing'>, string> = {
  passing: 'passing',
  running: 'running',
  cancelled: 'cancelled',
  skipped: 'skipped',
  neutral: 'neutral',
};

export function otherChecksLine(runs: readonly PrCheckRun[]): string {
  return (Object.keys(CHECK_WORDS) as (keyof typeof CHECK_WORDS)[])
    .map((state) => {
      const count = runs.filter((run) => run.state === state).length;
      return count > 0 ? `${count} ${CHECK_WORDS[state]}` : null;
    })
    .filter((part) => part !== null)
    .join(' · ');
}

const REVIEW_WORDS: Record<PrDetails['reviewers'][number]['state'], string> = {
  changes_requested: 'changes requested',
  approved: 'approved',
  commented: 'commented',
};

export function reviewsLine(reviewers: PrDetails['reviewers']): string {
  return (Object.keys(REVIEW_WORDS) as (keyof typeof REVIEW_WORDS)[])
    .map((state) => {
      const count = reviewers.filter((reviewer) => reviewer.state === state).length;
      return count > 0 ? `${count} ${REVIEW_WORDS[state]}` : null;
    })
    .filter((part) => part !== null)
    .join(' · ');
}

export const THREAD_CAP = 5;

export function threadWhere(thread: PrDetails['threads'][number]): string {
  if (!thread.path) return thread.author;
  return `${thread.author} · ${thread.path}${thread.line ? `:${thread.line}` : ''}`;
}
