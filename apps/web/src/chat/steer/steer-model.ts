import {
  isTerminalRunStatus,
  type ConversationDetail,
  type MemberMessage,
  type Run,
} from '@spark-outpost/contracts';
import { providerName } from '../provider-name.ts';
import { turnRunIds } from '../turn-props.ts';
import { activeRun } from '../turns.ts';

export type SteerTone = 'wait' | 'ok' | 'miss';

function messageState(message: MemberMessage, live: boolean, name: string): string {
  switch (message.status) {
    case 'queued':
      return live ? `${name} reads this at its next step` : `${name} finished before reading this`;
    case 'delivered':
      return `${name} has it`;
    case 'interrupting':
      return 'Stopping the turn to send this first';
    case 'sent':
      return 'Sent as your next message';
    case 'missed':
      return `${name} finished before reading this`;
    case 'continued':
      return `${name} picked this up in a new turn`;
  }
}

function messageTone(message: MemberMessage, live: boolean): SteerTone {
  if (message.status === 'missed' || (message.status === 'queued' && !live)) return 'miss';
  if (message.status === 'queued' || message.status === 'interrupting') return 'wait';
  return 'ok';
}

export interface SteerStatus {
  text: string;
  tone: SteerTone;
}

const BECAME_MESSAGE = new Set<MemberMessage['status']>(['sent', 'continued']);
const UNREAD = new Set<MemberMessage['status']>(['queued', 'interrupting']);
const SEVERAL_READERS = 'The crew';

export function steerAnchor(messageId: string): string {
  return `steer-${messageId}`;
}

export function turnSteers(detail: ConversationDetail, runId: string): MemberMessage[] {
  const all = detail.memberMessages ?? [];
  if (all.length === 0) return [];
  const inTurn = new Set(turnRunIds(detail, runId));
  const sent = new Set(detail.messages.map((message) => message.id));
  return all.filter(
    (message) =>
      inTurn.has(message.runId) &&
      message.messageId === null &&
      !BECAME_MESSAGE.has(message.status) &&
      !sent.has(message.id),
  );
}

export function steerSlots(
  blockTimes: readonly (string | null)[],
  messages: readonly MemberMessage[],
): Map<number, MemberMessage[]> {
  const slots = new Map<number, MemberMessage[]>();
  for (const message of messages) {
    const at = Date.parse(message.createdAt);
    const slot = blockTimes.findLastIndex((time) => time !== null && Date.parse(time) <= at);
    slots.set(slot, [...(slots.get(slot) ?? []), message]);
  }
  return slots;
}

function waitingReaders(detail: ConversationDetail, run: Run): string[] {
  const crew = detail.orchestrations?.[run.id]?.crew ?? [];
  return crew
    .filter(
      (member) =>
        member.runId !== run.id && member.role !== 'spark' && !isTerminalRunStatus(member.status),
    )
    .map((member) => member.name);
}

function readerName(
  message: MemberMessage,
  detail: ConversationDetail,
  run: Run,
  crew: boolean,
): string {
  const readerId = message.deliveredRunId ?? message.runId;
  const member = detail.orchestrations?.[run.id]?.crew.find((entry) => entry.runId === readerId);
  if (!crew) return providerName(member?.provider ?? run.provider);
  const undecided = readerId === run.id && message.urgency === 'now' && UNREAD.has(message.status);
  if (undecided) {
    const readers = waitingReaders(detail, run);
    if (readers.length === 1) return readers[0]!;
    if (readers.length > 1) return SEVERAL_READERS;
  }
  return member?.name ?? providerName(run.provider);
}

function targetIsLive(message: MemberMessage, detail: ConversationDetail, run: Run): boolean {
  const member = detail.orchestrations?.[run.id]?.crew.find(
    (entry) => entry.runId === message.runId,
  );
  const target = detail.runs.find((candidate) => candidate.id === message.runId);
  const status = member?.status ?? target?.status;
  return status !== undefined && !isTerminalRunStatus(status);
}

export function steerStatus(
  message: MemberMessage,
  detail: ConversationDetail,
  run: Run,
  crew: boolean,
): SteerStatus {
  const live = targetIsLive(message, detail, run);
  if (message.urgency === 'now' && message.status === 'queued' && !live) {
    return { text: 'Sending this as your next message', tone: 'wait' };
  }
  return {
    text: messageState(message, live, readerName(message, detail, run, crew)),
    tone: messageTone(message, live),
  };
}

export function withSteer(
  detail: ConversationDetail,
  id: string,
  body: string,
  createdAt: string,
): ConversationDetail {
  const running = activeRun(detail);
  const known = detail.memberMessages ?? [];
  if (!running || known.some((message) => message.id === id)) return detail;
  const steer: MemberMessage = {
    id,
    runId: running.id,
    body,
    urgency: 'now',
    status: 'queued',
    messageId: null,
    createdAt,
    deliveredAt: null,
  };
  return { ...detail, memberMessages: [...known, steer] };
}
