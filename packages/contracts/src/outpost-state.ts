import { NEEDS_YOU_PREFIX } from './orchestration.ts';
import type {
  DerivedRequestState,
  RejectReason,
  RequestFacts,
  RequestStateOf,
} from './outposts.ts';
import type { RunStatus } from './runs.ts';

const NOT_DELIVERED = 'Not delivered';

const REJECT_WORDS: Record<RejectReason, string> = {
  queue_full: 'queue full',
  chat_archived: 'chat archived',
  not_member: 'no longer a member',
};

const HELD_WORDS: Record<NonNullable<RequestFacts['held']>, string> = {
  failed: 'failed',
  stopped: 'was stopped',
};

function isRejectReason(reason: string): reason is RejectReason {
  return Object.hasOwn(REJECT_WORDS, reason);
}

function notDeliveredLine(closedReason: string | null): string {
  if (closedReason === null || closedReason.trim() === '') return NOT_DELIVERED;
  const words = isRejectReason(closedReason) ? REJECT_WORDS[closedReason] : closedReason.trim();
  return `${NOT_DELIVERED}: ${words}`;
}

function closedRequest(facts: RequestFacts): DerivedRequestState | null {
  if (facts.closedState === 'cancelled') return { state: 'cancelled', reason: null };
  if (facts.closedState === 'failed') return { state: 'failed', reason: facts.closedReason };
  if (facts.closedState === 'rejected') {
    return { state: 'failed', reason: notDeliveredLine(facts.closedReason) };
  }
  return null;
}

function needsYouReason(line: string): string | null {
  const start = line.trimStart();
  const question = start.startsWith(NEEDS_YOU_PREFIX)
    ? start.slice(NEEDS_YOU_PREFIX.length)
    : start;
  const text = question.trim();
  return text === '' ? null : text;
}

function succeededRequest(facts: RequestFacts): DerivedRequestState {
  if (facts.runNeedsYou === null) return { state: 'answered', reason: null };
  return { state: 'needs_you', reason: needsYouReason(facts.runNeedsYou) };
}

function runRequest(status: RunStatus, facts: RequestFacts): DerivedRequestState {
  const handle = `@${facts.toHandle}`;
  switch (status) {
    case 'queued':
      return { state: 'sent', reason: null };
    case 'running':
      return { state: 'working', reason: null };
    case 'awaiting_approval':
      return { state: 'needs_you', reason: `${handle} is waiting for your approval` };
    case 'succeeded':
      return succeededRequest(facts);
    case 'failed':
      return { state: 'failed', reason: `${handle}'s turn failed` };
    case 'outcome_unknown':
      return { state: 'failed', reason: `${handle}'s turn was interrupted` };
    case 'cancelled':
      return { state: 'cancelled', reason: null };
  }
}

function waitingRequest(facts: RequestFacts): DerivedRequestState {
  if (facts.paused) return { state: 'sent', reason: 'Paused' };
  if (!facts.sent) return { state: 'sent', reason: 'Not sent yet' };
  if (facts.queued && facts.held) {
    return {
      state: 'sent',
      reason: `Waiting: @${facts.toHandle}'s last turn ${HELD_WORDS[facts.held]}`,
    };
  }
  return { state: 'sent', reason: null };
}

export const requestState: RequestStateOf = (facts) => {
  const closed = closedRequest(facts);
  if (closed) return closed;
  if (facts.chatDeleted) return { state: 'failed', reason: 'Chat deleted' };
  if (facts.runStatus !== null) return runRequest(facts.runStatus, facts);
  return waitingRequest(facts);
};
