import type { InboxTicket, PullRequestStatus } from '@spark-outpost/contracts';
import type { GlyphName } from './ticket-icons.tsx';

export type PullTone = 'muted' | 'open' | 'bad' | 'warn' | 'good' | 'merged';

export interface PullBadge {
  label: string;
  tone: PullTone;
  glyph: GlyphName;
}

export function pullBadge(pull: PullRequestStatus | null): PullBadge {
  if (!pull) return { label: 'status not available', tone: 'muted', glyph: 'pr' };
  if (pull.state === 'merged') return { label: 'merged', tone: 'merged', glyph: 'pr-merged' };
  if (pull.state === 'closed') return { label: 'closed', tone: 'muted', glyph: 'pr-closed' };
  if (pull.checks === 'failing') return { label: 'checks failing', tone: 'bad', glyph: 'x-circle' };
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
