import {
  SUB_CHAT_GROUP_ORDER,
  SUB_CHAT_STATUS_WORDS,
  type SubChatPullRequest,
  type SubChatRow,
  type SubChatStatus,
} from '@spark-outpost/contracts';

export interface SubChatGroup {
  status: SubChatStatus;
  label: string;
  rows: SubChatRow[];
}

export function subChatGroups(rows: readonly SubChatRow[]): SubChatGroup[] {
  const ordered = rows.toSorted((a, b) => a.position - b.position);
  return SUB_CHAT_GROUP_ORDER.map((status) => ({
    status,
    label: SUB_CHAT_STATUS_WORDS[status],
    rows: ordered.filter((row) => row.status === status),
  }));
}

const CHECK_WORDS: Record<SubChatPullRequest['checks'], string> = {
  passing: 'checks passing',
  failing: 'checks failing',
  pending: 'checks running',
  none: 'no checks',
};

const PULL_STATE_WORDS: Record<SubChatPullRequest['state'], string | null> = {
  open: null,
  merged: 'merged',
  closed: 'closed',
};

export function pullRequestFact(pullRequest: SubChatPullRequest | null): string {
  if (!pullRequest) return 'no pull request yet';
  return PULL_STATE_WORDS[pullRequest.state] ?? CHECK_WORDS[pullRequest.checks];
}

export function placementFact(row: Pick<SubChatRow, 'stackedOn' | 'startsAfter'>): string | null {
  if (row.stackedOn) return `stacked on ${row.stackedOn.title}`;
  if (row.startsAfter.length === 0) return null;
  return `Starts after ${row.startsAfter.map((chat) => chat.title).join(', ')}`;
}

export function canStartAnyway(row: Pick<SubChatRow, 'status' | 'startedAt'>): boolean {
  return row.status === 'held' && row.startedAt === null;
}

export const SUB_CHATS_FOOTER =
  'Spark never merges. Each sub-chat publishes under its own mode and autonomy.';
