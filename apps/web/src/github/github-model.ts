import type { GithubInbox, GithubInboxGroup, GithubInboxItem } from '@spark-outpost/contracts';

export const GROUPS: readonly GithubInboxGroup[] = [
  'review_requested',
  'needs_fixes',
  'ready_to_merge',
  'waiting',
];

export const GROUP_LABEL: Record<GithubInboxGroup, string> = {
  review_requested: 'Review requested',
  needs_fixes: 'Needs fixes',
  ready_to_merge: 'Ready to merge',
  waiting: 'Waiting on others',
};

export type PrState = 'passing' | 'failing' | 'running' | 'conflict' | 'draft';

export const STATE_LABEL: Record<PrState, string> = {
  passing: 'Passing',
  failing: 'Failing',
  running: 'Running',
  conflict: 'Conflict',
  draft: 'Draft',
};

export type ListEntry =
  { kind: 'item'; item: GithubInboxItem } | { kind: 'bots'; items: GithubInboxItem[] };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

function elapsed(iso: string, now: number): number {
  return Math.max(0, now - new Date(iso).getTime());
}

export function ageLabel(iso: string, now: number): string {
  const ms = elapsed(iso, now);
  if (ms < MINUTE) return 'now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h`;
  if (ms < 5 * WEEK) return `${Math.floor(ms / DAY)} d`;
  return `${Math.floor(ms / WEEK)} w`;
}

function daysLabel(iso: string, now: number): string {
  const days = Math.floor(elapsed(iso, now) / DAY);
  if (days < 1) return 'today';
  return days === 1 ? '1 day' : `${days} days`;
}

export function isFresh(item: GithubInboxItem): boolean {
  return item.unseen || item.updatedSinceSeen;
}

export function hasUpdates(inbox: GithubInbox | undefined): boolean {
  return Boolean(inbox?.connected && inbox.items.some(isFresh));
}

export function prState(item: GithubInboxItem): PrState | null {
  if (item.draft) return 'draft';
  if (item.conflict) return 'conflict';
  if (item.checks === 'failing' || item.failingChecks > 0) return 'failing';
  if (item.checks === 'pending') return 'running';
  if (item.checks === 'passing') return 'passing';
  return null;
}

export function botsState(items: readonly GithubInboxItem[]): PrState | null {
  const states = items.map(prState);
  if (states.includes('failing')) return 'failing';
  if (states.includes('conflict')) return 'conflict';
  if (states.includes('running')) return 'running';
  if (states.length > 0 && states.every((state) => state === 'passing')) return 'passing';
  return null;
}

export function filterByProject(
  items: readonly GithubInboxItem[],
  projectId: string,
): GithubInboxItem[] {
  return projectId ? items.filter((item) => item.projectId === projectId) : [...items];
}

export function groupItems(
  items: readonly GithubInboxItem[],
): Record<GithubInboxGroup, GithubInboxItem[]> {
  const grouped: Record<GithubInboxGroup, GithubInboxItem[]> = {
    review_requested: [],
    needs_fixes: [],
    ready_to_merge: [],
    waiting: [],
  };
  for (const item of items) grouped[item.group].push(item);
  return grouped;
}

export function defaultGroup(
  grouped: Record<GithubInboxGroup, GithubInboxItem[]>,
): GithubInboxGroup {
  return GROUPS.find((group) => grouped[group].length > 0) ?? 'review_requested';
}

function joinParts(parts: (string | null)[]): string {
  return parts.filter(Boolean).join(' · ');
}

function countPart(count: number, word: string): string | null {
  return count > 0 ? `${count} ${word}` : null;
}

export function tileLine(
  group: GithubInboxGroup,
  items: readonly GithubInboxItem[],
  now: number,
): string {
  if (items.length === 0) return 'Nothing here';
  if (group === 'review_requested') {
    const fresh = items.filter((item) => item.unseen).length;
    return fresh > 0 ? `${fresh} new` : 'All seen';
  }
  if (group === 'needs_fixes') {
    const line = joinParts([
      countPart(items.filter((item) => prState(item) === 'failing').length, 'failing'),
      countPart(items.filter((item) => item.conflict).length, 'conflict'),
      countPart(items.filter((item) => item.changesRequested).length, 'changes requested'),
    ]);
    return line || countPart(items.filter((item) => item.behind).length, 'behind') || '';
  }
  if (group === 'ready_to_merge') return 'Approved, checks pass';
  const oldest = items.reduce(
    (first, item) => (item.updatedAt < first ? item.updatedAt : first),
    items[0]!.updatedAt,
  );
  return `Oldest ${daysLabel(oldest, now)}`;
}

function byUpdated(direction: 1 | -1) {
  return (left: GithubInboxItem, right: GithubInboxItem) =>
    direction * left.updatedAt.localeCompare(right.updatedAt);
}

function rank(item: GithubInboxItem): number {
  if (item.draft) return 2;
  return isFresh(item) ? 0 : 1;
}

export function sortItems(
  group: GithubInboxGroup,
  items: readonly GithubInboxItem[],
): GithubInboxItem[] {
  const tiebreak = group === 'review_requested' ? byUpdated(1) : byUpdated(-1);
  return [...items].sort((left, right) => rank(left) - rank(right) || tiebreak(left, right));
}

export function listEntries(
  group: GithubInboxGroup,
  items: readonly GithubInboxItem[],
): ListEntry[] {
  const sorted = sortItems(group, items);
  if (group !== 'review_requested') return sorted.map((item) => ({ kind: 'item', item }));
  const bots = sorted.filter((item) => item.authorIsBot);
  const people: ListEntry[] = sorted
    .filter((item) => !item.authorIsBot)
    .map((item) => ({ kind: 'item', item }));
  if (bots.length === 0) return people;
  if (bots.length === 1) return [...people, { kind: 'item', item: bots[0]! }];
  return [...people, { kind: 'bots', items: bots }];
}

export function markSeen(
  inbox: GithubInbox | undefined,
  id: string,
  headSha: string,
): GithubInbox | undefined {
  if (!inbox) return inbox;
  return {
    ...inbox,
    items: inbox.items.map((item) =>
      item.id === id && item.headSha === headSha
        ? { ...item, unseen: false, updatedSinceSeen: false }
        : item,
    ),
  };
}

export function sizeLine(item: GithubInboxItem): string | null {
  if (item.additions === null || item.deletions === null) return null;
  const files =
    item.changedFiles === null
      ? ''
      : ` in ${item.changedFiles} ${item.changedFiles === 1 ? 'file' : 'files'}`;
  return `+${item.additions} −${item.deletions}${files}`;
}

export function checksLine(item: GithubInboxItem): string {
  if (item.checks === 'failing' || item.failingChecks > 0) {
    return item.failingChecks > 0
      ? `${item.failingChecks} failing ${item.failingChecks === 1 ? 'check' : 'checks'}`
      : 'Checks failing';
  }
  if (item.checks === 'pending') return 'Checks running';
  if (item.checks === 'passing') return 'Checks passing';
  return 'No checks';
}

export function dayLabel(iso: string, now: number): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function updatedLabel(iso: string, now: number): string {
  const age = ageLabel(iso, now);
  return age === 'now' ? 'updated just now' : `updated ${age} ago`;
}

export function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function labelColor(color: string | null): string | undefined {
  return color ? `#${color}` : undefined;
}
