import type {
  InboxTicket,
  PullRequestChecks,
  PullRequestStatus,
  TicketRef,
} from '@spark-outpost/contracts';
import type { GlyphName } from './ticket-icons.tsx';

export type PullTone = 'muted' | 'open' | 'bad' | 'warn' | 'good' | 'merged';

export interface PullBadge {
  label: string;
  tone: PullTone;
  glyph: GlyphName;
}

const isOpen = (pull: PullRequestStatus) => pull.state !== 'merged' && pull.state !== 'closed';

export function pullBadge(pull: PullRequestStatus | null): PullBadge {
  if (pull && isOpen(pull) && pull.checks === 'failing') {
    return { label: 'checks failing', tone: 'bad', glyph: 'x-circle' };
  }
  return reviewBadge(pull);
}

export function reviewBadge(pull: PullRequestStatus | null): PullBadge {
  if (!pull) return { label: 'status not available', tone: 'muted', glyph: 'pr' };
  if (pull.state === 'merged') return { label: 'merged', tone: 'merged', glyph: 'pr-merged' };
  if (pull.state === 'closed') return { label: 'closed', tone: 'muted', glyph: 'pr-closed' };
  if (pull.state === 'draft') return { label: 'draft', tone: 'muted', glyph: 'pr-draft' };
  if (pull.state === 'changes_requested') {
    return { label: 'changes requested', tone: 'warn', glyph: 'warn' };
  }
  if (pull.state === 'approved') return { label: 'approved', tone: 'good', glyph: 'check' };
  return { label: 'open', tone: 'open', glyph: 'pr' };
}

export function pullNumber(ticket: InboxTicket, url: string): number | null {
  if (ticket.pullRequest) return ticket.pullRequest.number;
  const match = /\/pull\/(\d+)(?:[/?#]|$)/.exec(url);
  return match ? Number(match[1]) : null;
}

const CHAT_STATES: Record<NonNullable<InboxTicket['chat']>['state'], string> = {
  asking: 'waiting for your answer',
  running: 'running',
  error: 'stopped with an error',
  finished: 'finished',
  idle: 'idle',
};

export function chatStateText(state: NonNullable<InboxTicket['chat']>['state']): string {
  return CHAT_STATES[state];
}

const PULL_URL =
  /^https?:\/\/[^/]+\/(.+?)\/(?:-\/)?(?:pull|pull-requests|merge_requests)\/(\d+)(?:[/?#]|$)/i;

export interface PullEntry {
  url: string;
  number: number | null;
  repo: string | null;
  title: string | null;
  badge: PullBadge;
  checks: PullRequestChecks | null;
  failedChecks: string[];
  origin?: string;
  note?: string | null;
}

function entryOf(ref: TicketRef, status: PullRequestStatus | null): PullEntry {
  const match = PULL_URL.exec(ref.url);
  const known = status?.url === ref.url ? status : null;
  return {
    url: ref.url,
    number: known?.number ?? (match ? Number(match[2]) : null),
    repo: known?.repo ?? match?.[1] ?? null,
    title: ref.title === ref.url ? null : ref.title,
    badge: reviewBadge(known),
    checks: known && isOpen(known) ? known.checks : null,
    failedChecks: known && isOpen(known) ? (known.failedChecks ?? []) : [],
  };
}

export function ticketPulls(
  ticket: InboxTicket | null,
  trackerLinks: readonly TicketRef[],
): PullEntry[] {
  const status = ticket?.pullRequest ?? null;
  const refs: TicketRef[] = [
    ...(status ? [{ title: status.url, url: status.url }] : []),
    ...(ticket?.work.flatMap((work) => work.pullRequests) ?? []),
    ...trackerLinks.filter((link) => PULL_URL.test(link.url)),
  ];
  const byUrl = new Map<string, TicketRef>();
  for (const ref of refs) {
    const seen = byUrl.get(ref.url);
    if (!seen || seen.title === seen.url) byUrl.set(ref.url, ref);
  }
  return [...byUrl.values()].map((ref) => entryOf(ref, status));
}
