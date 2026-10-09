import type { PrRefreshProblem, PrWatch } from '@spark-outpost/contracts';

export type PullState = 'draft' | 'open' | 'merged' | 'closed';
export type CiState = 'failing' | 'pending' | 'unknown' | 'passing' | 'none';
export type Tone = 'ok' | 'prog' | 'bad' | 'plain';

export function pullState(watch: Pick<PrWatch, 'prState' | 'draft'>): PullState {
  if (watch.prState !== 'open') return watch.prState;
  return watch.draft ? 'draft' : 'open';
}

export const PULL_STATE_LABELS: Record<PullState, string> = {
  draft: 'Draft',
  open: 'Open',
  merged: 'Merged',
  closed: 'Closed',
};

export function ciState(watch: Pick<PrWatch, 'checks' | 'unknownReason'>): CiState {
  return watch.unknownReason ? 'unknown' : watch.checks;
}

export const CI_LABELS: Record<CiState, string> = {
  failing: 'Checks failing',
  pending: 'Checks running',
  unknown: 'Checks unknown',
  passing: 'Checks passing',
  none: 'No checks',
};

export const CI_TONES: Record<CiState, Tone> = {
  failing: 'bad',
  pending: 'prog',
  unknown: 'plain',
  passing: 'ok',
  none: 'plain',
};

const WORST_FIRST: readonly CiState[] = ['failing', 'pending', 'unknown', 'passing', 'none'];

export function worstCi(watches: readonly PrWatch[]): CiState {
  const open = watches.filter((watch) => watch.prState === 'open');
  const states = new Set((open.length > 0 ? open : watches).map(ciState));
  return WORST_FIRST.find((state) => states.has(state)) ?? 'none';
}

export function primaryPull(watches: readonly PrWatch[]): PrWatch | null {
  const open = watches.filter((watch) => watch.phase !== 'done');
  const pool = open.length > 0 ? open : watches;
  const worst = worstCi(pool);
  return pool.find((watch) => ciState(watch) === worst) ?? pool[0] ?? null;
}

export interface RepoGroup {
  repo: string;
  outside: boolean;
  pulls: PrWatch[];
}

export function groupByRepo(watches: readonly PrWatch[]): RepoGroup[] {
  const groups = new Map<string, RepoGroup>();
  for (const watch of watches) {
    const key = watch.repo.toLowerCase();
    const group = groups.get(key) ?? { repo: watch.repo, outside: watch.outside, pulls: [] };
    group.pulls.push(watch);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, pulls: group.pulls.toSorted((a, b) => b.number - a.number) }))
    .toSorted((a, b) => Number(a.outside) - Number(b.outside) || a.repo.localeCompare(b.repo));
}

const REVIEW_LABELS: Record<PrWatch['review'], string | null> = {
  none: null,
  approved: 'Approved',
  changes_requested: 'Changes requested',
};

export function reviewLabel(watch: Pick<PrWatch, 'review' | 'newComments'>): string | null {
  const comments =
    watch.newComments > 0
      ? `${watch.newComments} open ${watch.newComments === 1 ? 'comment' : 'comments'}`
      : null;
  const parts = [REVIEW_LABELS[watch.review], comments].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function openedLine(opened: PrWatch['opened'], agentName: (id: string) => string): string {
  if (opened.via === 'ship') return 'Opened by Spark';
  if (opened.via === 'terminal') return 'Opened from the terminal';
  if (opened.via === 'discovery') return 'Found on this chat’s branch';
  return opened.by ? `Opened by ${agentName(opened.by)}` : 'Opened by the agent';
}

export function branchLine(watch: Pick<PrWatch, 'branch' | 'base'>): string | null {
  if (!watch.branch) return null;
  return watch.base ? `${watch.branch} → ${watch.base}` : watch.branch;
}

export function openedIn(watches: readonly PrWatch[], runIds: readonly string[]): PrWatch[] {
  return watches
    .filter((watch) => watch.opened.runId !== null && runIds.includes(watch.opened.runId))
    .toSorted((a, b) => a.opened.at.localeCompare(b.opened.at));
}

export const NO_ANSWER_LINE = 'GitHub did not answer. Try again.';

const REFRESH_PROBLEM_LINES: Record<PrRefreshProblem, string> = {
  not_connected: 'GitHub is not connected. Connect GitHub in Settings.',
  no_access: 'Your GitHub connection can’t read this repository.',
  rate_limit: 'GitHub’s rate limit is used up. Try again later.',
  offline: NO_ANSWER_LINE,
  error: NO_ANSWER_LINE,
  no_answer: NO_ANSWER_LINE,
};

export const refreshProblemLine = (problem: PrRefreshProblem) => REFRESH_PROBLEM_LINES[problem];

const repoName = (repo: string) => repo.slice(repo.lastIndexOf('/') + 1);

export function repoLabels(watches: readonly Pick<PrWatch, 'repo'>[]): Map<string, string> {
  const repos = new Set(watches.map((watch) => watch.repo.toLowerCase()));
  const sameName = (repo: string) =>
    [...repos].filter((other) => repoName(other) === repoName(repo.toLowerCase())).length > 1;
  return new Map(
    watches.map((watch) => [watch.repo, sameName(watch.repo) ? watch.repo : repoName(watch.repo)]),
  );
}

interface LineChange {
  added: number;
  removed: number;
}

export function lineChange(watch: Pick<PrWatch, 'additions' | 'deletions'>): LineChange | null {
  if (watch.additions === null || watch.deletions === null) return null;
  if (watch.additions + watch.deletions === 0) return null;
  return { added: watch.additions, removed: watch.deletions };
}

export function lineChangeLabel({ added, removed }: LineChange): string {
  const count = (value: number) => value.toLocaleString('en-US');
  return `${count(added)} ${added === 1 ? 'line' : 'lines'} added, ${count(removed)} removed`;
}
