import type { Approval, ConversationSummary } from '@spark-outpost/contracts';
import { isRunning, rowState } from '../conversations/row-state.ts';

export type Panel = 'home' | 'quick' | 'sessions' | 'ask';

export type CardKind = 'approval' | 'force' | 'question' | 'open';

export interface Card {
  kind: CardKind;
  chat: ConversationSummary;
  approval: Approval | null;
}

export interface Moment {
  kind: 'done' | 'failed';
  chatId: string;
  runId: string;
}

export interface IslandInputs {
  note: boolean;
  panel: Panel | null;
  cards: readonly Card[];
  review: string | null;
  nudge: boolean;
}

export type IslandView =
  | { kind: 'note' }
  | { kind: 'panel'; panel: Panel }
  | { kind: 'card'; card: Card; index: number; total: number }
  | { kind: 'nudge'; card: Card; total: number }
  | { kind: 'peek' };

export function islandView(inputs: IslandInputs): IslandView {
  if (inputs.note) return { kind: 'note' };
  if (inputs.panel) return { kind: 'panel', panel: inputs.panel };
  const total = inputs.cards.length;
  const reviewed = inputs.cards.findIndex((card) => cardKey(card) === inputs.review);
  if (reviewed >= 0) {
    return { kind: 'card', card: inputs.cards[reviewed]!, index: reviewed + 1, total };
  }
  const first = inputs.cards[0];
  if (first && inputs.nudge) return { kind: 'nudge', card: first, total };
  return { kind: 'peek' };
}

export type HoverOpen = { kind: 'home' } | { kind: 'card'; card: Card } | null;

export function hoverOpens(view: IslandView): HoverOpen {
  if (view.kind === 'peek') return { kind: 'home' };
  if (view.kind === 'nudge') return { kind: 'card', card: view.card };
  return null;
}

const WIDTHS = {
  note: 420,
  home: 680,
  quick: 640,
  sessions: 640,
  ask: 640,
  approval: 556,
  force: 556,
  question: 556,
  open: 520,
  nudge: 364,
} as const;

export function viewWidth(view: IslandView, notchWidth: number): number {
  switch (view.kind) {
    case 'panel':
      return WIDTHS[view.panel];
    case 'card':
      return WIDTHS[view.card.kind];
    case 'peek':
      return Math.max(notchWidth, 72);
    default:
      return WIDTHS[view.kind];
  }
}

export function isQuiet(view: IslandView): boolean {
  return view.kind === 'peek' || view.kind === 'nudge';
}

export type RunStatuses = ReadonlyMap<string, { status: string; chatId: string }>;

export function runStatuses(chats: readonly ConversationSummary[]): RunStatuses {
  return new Map(
    chats.flatMap((chat) =>
      chat.latestRun
        ? [[chat.latestRun.id, { status: chat.latestRun.status, chatId: chat.id }]]
        : [],
    ),
  );
}

const LIVE = new Set(['queued', 'running', 'awaiting_approval']);

export function newMoments(previous: RunStatuses, chats: readonly ConversationSummary[]): Moment[] {
  return chats.flatMap((chat): Moment[] => {
    const run = chat.latestRun;
    if (!run) return [];
    const before = previous.get(run.id)?.status;
    if (!before || !LIVE.has(before)) return [];
    if (run.status === 'succeeded') return [{ kind: 'done', chatId: chat.id, runId: run.id }];
    if (run.status === 'failed') return [{ kind: 'failed', chatId: chat.id, runId: run.id }];
    return [];
  });
}

export function nextStreak(streak: number, moment: Moment): number {
  return moment.kind === 'done' ? streak + 1 : 0;
}

function cardKind(chat: ConversationSummary, approval: Approval | null): CardKind {
  if (!approval) return 'open';
  if (approval.payload.forcePush) return 'force';
  if (approval.payload.gitControl || approval.payload.instructionFiles) return 'open';
  const checkpoint = approval.payload.checkpoint;
  if (checkpoint) {
    const simple = checkpoint.kind === 'clarify' && checkpoint.questions.length === 0;
    return simple && checkpoint.choices.length > 0 ? 'question' : 'open';
  }
  if (approval.payload.sparkAction || approval.payload.plan) return 'open';
  if (chat.attention?.kind !== 'permission') return 'open';
  return 'approval';
}

export function pendingCards(
  chats: readonly ConversationSummary[],
  approvalsByChat: ReadonlyMap<string, readonly Approval[]>,
  snoozed: ReadonlySet<string>,
): Card[] {
  return chats
    .filter((chat) => !chat.archivedAt && chat.needsInput)
    .map((chat): Card => {
      const pending = (approvalsByChat.get(chat.id) ?? []).filter(
        (approval) => approval.status === 'pending',
      );
      const wanted = chat.attention?.approvalId;
      const approval =
        pending.find((candidate) => candidate.id === wanted) ?? pending.at(-1) ?? null;
      return { kind: cardKind(chat, approval), chat, approval };
    })
    .filter((card) => !snoozed.has(cardKey(card)))
    .sort((a, b) => cardTime(a).localeCompare(cardTime(b)));
}

function cardTime(card: Card): string {
  return card.approval?.createdAt ?? card.chat.updatedAt;
}

export function cardKey(card: Card): string {
  return card.approval?.id ?? `chat:${card.chat.id}:${card.chat.updatedAt}`;
}

export type SessionState = 'working' | 'waiting' | 'done' | 'failed' | 'idle';

export function sessionState(chat: ConversationSummary): SessionState {
  const tone = rowState(chat, false).tone;
  if (tone === 'permission' || tone === 'asking') return 'waiting';
  if (tone === 'running') return 'working';
  if (tone === 'error') return 'failed';
  if (chat.latestRun?.status === 'succeeded') return 'done';
  return 'idle';
}

const SESSION_RANK: Record<SessionState, number> = {
  waiting: 0,
  working: 1,
  failed: 2,
  done: 3,
  idle: 4,
};

export function rankedSessions(
  chats: readonly ConversationSummary[],
  hidden: ReadonlySet<string>,
): ConversationSummary[] {
  return chats
    .filter((chat) => !chat.archivedAt && !hidden.has(chat.id))
    .toSorted(
      (a, b) =>
        SESSION_RANK[sessionState(a)] - SESSION_RANK[sessionState(b)] ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
}

export const ACTIVE_MS = 20 * 60_000;
export const PEEK_LIMIT = 5;

export interface PeekRow {
  sessions: ConversationSummary[];
  more: number;
}

export function peekRow(
  chats: readonly ConversationSummary[],
  hidden: ReadonlySet<string>,
  now: number,
): PeekRow {
  const active = chats
    .filter((chat) => !chat.archivedAt && !hidden.has(chat.id))
    .filter(
      (chat) => isRunning(chat) || chat.needsInput || now - Date.parse(chat.updatedAt) <= ACTIVE_MS,
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { sessions: active.slice(0, PEEK_LIMIT), more: Math.max(0, active.length - PEEK_LIMIT) };
}

const SLOT_GAP = 26;
const SCOUT_CLEARANCE = 30;

export function peekOffset(slot: number): number {
  const side = slot % 2 === 0 ? 1 : -1;
  return side * (SCOUT_CLEARANCE + Math.floor(slot / 2) * SLOT_GAP);
}

export function waitingCount(chats: readonly ConversationSummary[], hidden: ReadonlySet<string>) {
  return chats.filter((chat) => !chat.archivedAt && !hidden.has(chat.id) && chat.needsInput).length;
}

export function matchesQuery(
  chat: ConversationSummary,
  projectNames: ReadonlyMap<string, string>,
  query: string,
): boolean {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return true;
  const projects = chat.projectIds.map((id) => projectNames.get(id) ?? '').join(' ');
  return `${chat.title} ${projects}`.toLowerCase().includes(wanted);
}
