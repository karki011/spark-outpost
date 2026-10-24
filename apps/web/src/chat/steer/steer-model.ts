import {
  isTerminalRunStatus,
  type ConversationDetail,
  type MemberMessage,
  type Run,
} from '@spark-outpost/contracts';
import { providerName } from '../provider-name.ts';
import type { SteerMark, TurnRowPart } from '../rows/turn-rows.ts';
import { turnRunIds } from '../turn-props.ts';
import { activeRun } from '../turns.ts';

export type SteerTone = 'wait' | 'ok' | 'miss' | 'stopped';

export interface SteerSeen {
  taken: boolean;
  answered: boolean;
}

const ASSUMED_SEEN: SteerSeen = { taken: true, answered: true };

interface StateFacts {
  live: boolean;
  name: string;
  stopped: boolean;
  seen: SteerSeen;
}

function sentState(name: string): SteerStatus {
  return { text: `Sent · ${name} reads it at its next step`, tone: 'wait' };
}

function deliveredState(message: MemberMessage, facts: StateFacts): SteerStatus {
  const { live, name, stopped, seen } = facts;
  if (live && !seen.taken) return sentState(name);
  if (!live && stopped && !seen.answered) {
    return { text: `Stopped before ${name} answered this`, tone: 'stopped' };
  }
  const taken = { text: `${name} took this in`, tone: 'ok' as const };
  return message.deliveredAt ? { ...taken, at: message.deliveredAt } : taken;
}

function messageState(message: MemberMessage, facts: StateFacts): SteerStatus {
  const { live, name, stopped } = facts;
  switch (message.status) {
    case 'queued':
      return live
        ? sentState(name)
        : { text: `${name} finished before reading this`, tone: 'miss' };
    case 'delivered':
      return deliveredState(message, facts);
    case 'interrupting':
      return { text: 'Stopping the turn to send this first', tone: 'wait' };
    case 'sent':
      return { text: 'Sent as your next message', tone: 'ok' };
    case 'missed':
      return {
        text: stopped ? `Stopped before ${name} read this` : `${name} finished before reading this`,
        tone: 'miss',
      };
    case 'continued':
      return { text: `${name} picked this up in a new turn`, tone: 'ok' };
  }
}

export interface SteerStatus {
  text: string;
  tone: SteerTone;
  at?: string;
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
  seen: SteerSeen = ASSUMED_SEEN,
): SteerStatus {
  const live = targetIsLive(message, detail, run);
  if (message.urgency === 'now' && message.status === 'queued' && !live) {
    return { text: 'Sending this as your next message', tone: 'wait' };
  }
  const name = readerName(message, detail, run, crew);
  return messageState(message, { live, name, stopped: run.status === 'cancelled', seen });
}

export function canResend(message: MemberMessage): boolean {
  return message.status === 'missed' && message.messageId === null;
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

export interface SteerGroupView {
  messages: MemberMessage[];
  status: SteerStatus;
}

const sameStatus = (left: SteerStatus, right: SteerStatus) =>
  left.text === right.text && left.tone === right.tone && left.at === right.at;

export function steerGroups(
  messages: readonly MemberMessage[],
  detail: ConversationDetail,
  run: Run,
  crew: boolean,
  seen?: SteerSeen,
): SteerGroupView[] {
  const groups: SteerGroupView[] = [];
  for (const message of messages) {
    const status = steerStatus(message, detail, run, crew, seen);
    const last = groups.at(-1);
    if (last && sameStatus(last.status, status)) last.messages.push(message);
    else groups.push({ messages: [message], status });
  }
  return groups;
}

const UNSEEN_TIME = Number.MAX_SAFE_INTEGER;

export function steerMarks(messages: readonly MemberMessage[]): SteerMark[] {
  return messages.map((message) => ({
    id: message.id,
    anchor:
      message.textOffset === null || message.textOffset === undefined
        ? null
        : {
            textOffset: message.textOffset,
            textBefore: message.textBefore ?? null,
            textHeld: message.textHeld ?? null,
          },
    time: message.deliveredAt ? Date.parse(message.deliveredAt) : UNSEEN_TIME,
  }));
}

export function seenAfter(parts: readonly TurnRowPart[], index: number): SteerSeen {
  const later = parts.slice(index + 1).filter((part) => part.kind !== 'steers');
  return { taken: later.length > 0, answered: later.some((part) => part.kind === 'text') };
}
