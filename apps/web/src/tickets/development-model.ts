import type {
  InboxTicket,
  ReportedPullState,
  TicketBuilds,
  TicketCommits,
  TicketDevelopment,
  TicketPull,
  TicketPullOrigin,
} from '@spark-outpost/contracts';
import { reviewBadge, type PullBadge, type PullEntry } from './row-links.ts';

const REPORTED: Record<ReportedPullState, PullBadge> = {
  open: { label: 'open', tone: 'open', glyph: 'pr' },
  draft: { label: 'draft', tone: 'muted', glyph: 'pr-draft' },
  merged: { label: 'merged', tone: 'merged', glyph: 'pr-merged' },
  declined: { label: 'declined', tone: 'muted', glyph: 'pr-closed' },
  unknown: { label: 'status not available', tone: 'muted', glyph: 'pr' },
};

export function originText(origin: TicketPullOrigin, sourceName: string): string {
  if (origin === 'spark') return 'Spark chat';
  return origin === 'linked' ? `Linked in ${sourceName}` : 'Matched by key';
}

export const reportedBadge = (pull: TicketPull): PullBadge =>
  pull.status ? reviewBadge(pull.status) : REPORTED[pull.reported];

function entryOf(pull: TicketPull, sourceName: string): PullEntry {
  const status = pull.status;
  const open = status !== null && status.state !== 'merged' && status.state !== 'closed';
  return {
    url: pull.url,
    number: pull.number,
    repo: pull.repo,
    title: pull.title,
    badge: reportedBadge(pull),
    checks: open ? status.checks : null,
    failedChecks: open ? (status.failedChecks ?? []) : [],
    origin: originText(pull.origin, sourceName),
    note: !status && pull.reported !== 'unknown' ? `Status from ${sourceName}` : null,
  };
}

export function developmentPulls(development: TicketDevelopment, sourceName: string): PullEntry[] {
  return development.pullRequests.map((pull) => entryOf(pull, sourceName));
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export const commitsText = (commits: TicketCommits) => plural(commits.count, 'commit');

export function buildsText(builds: TicketBuilds): { text: string; failing: boolean } {
  if (builds.failed > 0) {
    return { text: `${builds.failed} of ${plural(builds.count, 'build')} failing`, failing: true };
  }
  const allPassed = builds.passed === builds.count;
  return { text: `${plural(builds.count, 'build')}${allPassed ? ' passing' : ''}`, failing: false };
}

export interface RowPull {
  url: string;
  number: number | null;
  repo: string | null;
  badge: PullBadge | null;
  more: number;
  origin: TicketPullOrigin | null;
}

export function rowPull(ticket: InboxTicket, url: string): RowPull {
  const pulls = ticket.development?.pullRequests ?? [];
  const shown = pulls.find((pull) => pull.url === url);
  return {
    url,
    number: ticket.pullRequest?.number ?? shown?.number ?? null,
    repo: ticket.pullRequest?.repo ?? shown?.repo ?? null,
    badge: !ticket.pullRequest && shown ? reportedBadge(shown) : null,
    more: shown ? pulls.length - 1 : 0,
    origin: shown?.origin ?? null,
  };
}
