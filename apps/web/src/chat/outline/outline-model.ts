import { clipAtWord, type ConversationDetail, type Run } from '@spark-outpost/contracts';
import { steerAnchor, turnSteers } from '../steer/steer-model.ts';
import { buildTurns } from '../turns.ts';

export type OutlineMark = 'plan' | 'approval' | 'files' | 'pr' | 'error';

export const OUTLINE_MARK_LABELS: Record<OutlineMark, string> = {
  plan: 'Plan',
  approval: 'Waited for you',
  files: 'Changed files',
  pr: 'Pull request',
  error: 'Error',
};

export interface OutlineEntry {
  id: string;
  anchor: string;
  label: string;
  reply: string;
  marks: OutlineMark[];
}

interface OutlineFacts {
  changedRunIds: ReadonlySet<string>;
  prUrls: readonly string[];
}

const OUTLINE_MIN_TURNS = 3;
const LABEL_LENGTH = 60;
const REPLY_LENGTH = 220;
const NO_TEXT = 'Message without text';
const FAILED: readonly Run['status'][] = ['failed', 'outcome_unknown'];

export function turnAnchor(runId: string): string {
  return `turn-${runId}`;
}

function turnOfRun(runs: readonly Run[]): Map<string, string> {
  const parents = new Map(runs.map((run) => [run.id, run.parentRunId ?? null]));
  const top = (runId: string): string => {
    let current = runId;
    for (let hops = 0; hops < runs.length; hops += 1) {
      const parent = parents.get(current);
      if (!parent) return current;
      current = parent;
    }
    return current;
  };
  return new Map(runs.map((run) => [run.id, top(run.id)]));
}

function promptLabel(content: string | undefined): string {
  const firstLine = content?.trim().split('\n')[0] ?? '';
  return clipAtWord(firstLine, LABEL_LENGTH) || NO_TEXT;
}

function replyPreview(content: string | undefined): string {
  const prose = (content ?? '')
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/[#*`>|]+/g, ' ')
    .replace(/\s+/g, ' ');
  return clipAtWord(prose, REPLY_LENGTH);
}

export type OutlineSource = Pick<
  ConversationDetail,
  'messages' | 'runs' | 'approvals' | 'plans' | 'memberMessages' | 'orchestrations'
>;

export function chatOutline(detail: OutlineSource, facts: OutlineFacts): OutlineEntry[] {
  const turns = buildTurns(detail);
  if (turns.length < OUTLINE_MIN_TURNS) return [];
  const turnOf = turnOfRun(detail.runs);
  const marked = new Map<string, Set<OutlineMark>>();
  const mark = (runId: string | null | undefined, kind: OutlineMark) => {
    const turn = runId ? turnOf.get(runId) : undefined;
    if (!turn) return;
    marked.set(turn, (marked.get(turn) ?? new Set()).add(kind));
  };
  const messageRun = new Map(detail.messages.map((message) => [message.id, message.runId]));

  for (const approval of detail.approvals) {
    if (approval.kind === 'plan' || approval.payload.plan) mark(approval.runId, 'plan');
    else if (approval.decidedBy === 'user' || approval.status === 'pending')
      mark(approval.runId, 'approval');
  }
  for (const offer of detail.plans?.offers ?? []) mark(offer.runId, 'plan');
  for (const line of detail.plans?.lines ?? []) mark(line.runId, 'plan');
  for (const saved of detail.plans?.saved ?? []) mark(messageRun.get(saved.messageId), 'plan');
  for (const runId of facts.changedRunIds) mark(runId, 'files');
  for (const message of detail.messages) {
    if (message.role !== 'assistant') continue;
    if (facts.prUrls.some((url) => message.content.includes(url))) mark(message.runId, 'pr');
  }
  for (const { run } of turns) if (FAILED.includes(run.status)) mark(run.id, 'error');

  const order: OutlineMark[] = ['plan', 'approval', 'files', 'pr', 'error'];
  return turns.flatMap(({ run, userMessage, assistantMessage }) => [
    {
      id: run.id,
      anchor: turnAnchor(run.id),
      label: promptLabel(userMessage?.content),
      reply: replyPreview(assistantMessage?.content),
      marks: order.filter((kind) => marked.get(run.id)?.has(kind)),
    },
    ...turnSteers(detail as ConversationDetail, run.id).map((message) => ({
      id: message.id,
      anchor: steerAnchor(message.id),
      label: promptLabel(message.body),
      reply: '',
      marks: [],
    })),
  ]);
}
