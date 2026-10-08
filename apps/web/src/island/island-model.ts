import type { Approval, ConversationSummary } from '@spark-outpost/contracts';
import { terminalMood } from '../terminal/native-state.ts';
import { isRunning, needsInput, rowState } from '../conversations/row-state.ts';

export type Panel = 'home' | 'quick' | 'sessions' | 'ask';

export type CardKind = 'approval' | 'force' | 'question' | 'open';

export interface Card {
  kind: CardKind;
  chat: ConversationSummary;
  approval: Approval | null;
  loading: boolean;
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
  full?: boolean;
  hoverOnly?: boolean;
}

export type IslandView =
  | { kind: 'note' }
  | { kind: 'panel'; panel: Panel }
  | { kind: 'card'; card: Card; index: number; total: number }
  | { kind: 'nudge'; card: Card; total: number }
  | { kind: 'now'; card: Card | null }
  | { kind: 'peek' };

export function islandView(inputs: IslandInputs): IslandView {
  if (inputs.note) return { kind: 'note' };
  if (inputs.panel) return { kind: 'panel', panel: inputs.panel };
  const total = inputs.cards.length;
  const reviewed = inputs.cards.findIndex((card) => card.chat.id === inputs.review);
  if (reviewed >= 0) {
    return { kind: 'card', card: inputs.cards[reviewed]!, index: reviewed + 1, total };
  }
  if (inputs.hoverOnly) return { kind: 'peek' };
  const first = (inputs.nudge && inputs.cards[0]) || null;
  if (inputs.full) return { kind: 'now', card: first };
  if (first) return { kind: 'nudge', card: first, total };
  return { kind: 'peek' };
}

export type QuickShortcutTarget =
  { kind: 'review'; chatId: string } | { kind: 'close' } | { kind: 'quick' };

export function quickShortcutTarget(
  panel: Panel | null,
  view: IslandView,
  pending: Card | null = null,
): QuickShortcutTarget {
  if (panel) return { kind: 'close' };
  const card =
    view.kind === 'card' || view.kind === 'nudge' || view.kind === 'now'
      ? view.card
      : view.kind === 'peek'
        ? pending
        : null;
  if (!card) return { kind: 'quick' };
  if (card.loading || card.kind === 'approval' || card.kind === 'force') {
    return { kind: 'review', chatId: card.chat.id };
  }
  return { kind: 'quick' };
}

export type HoverOpen = { kind: 'home' } | { kind: 'card'; card: Card } | null;

export function hoverOpens(view: IslandView, pending: Card | null = null): HoverOpen {
  if (view.kind === 'peek') return pending ? { kind: 'card', card: pending } : { kind: 'home' };
  if (view.kind === 'nudge') return { kind: 'card', card: view.card };
  if (view.kind === 'now') return view.card ? { kind: 'card', card: view.card } : { kind: 'home' };
  return null;
}

const CARD_WIDTHS = {
  approval: 556,
  force: 556,
  question: 556,
  open: 520,
} as const;
const NOTE_WIDTH = 420;
const NUDGE_WIDTH = 364;
const NOW_WIDTH = 400;
const NOW_WING = 104;
const HOME_WIDTH = { share: 0.5, min: 720, max: 920 } as const;
const PANEL_WIDTH = { share: 0.42, min: 640, max: 760 } as const;
const CHAT_MIN_WIDTH = 690;

function scaled(screenWidth: number, range: { share: number; min: number; max: number }): number {
  return Math.round(Math.min(range.max, Math.max(range.min, screenWidth * range.share)));
}

export function panelWidth(panel: Panel, screenWidth: number): number {
  return scaled(screenWidth, panel === 'home' ? HOME_WIDTH : PANEL_WIDTH);
}

export function chatWidth(screenWidth: number): number {
  return Math.max(CHAT_MIN_WIDTH, scaled(screenWidth, PANEL_WIDTH));
}

export function viewWidth(view: IslandView, notchWidth: number, screenWidth: number): number {
  switch (view.kind) {
    case 'panel':
      return panelWidth(view.panel, screenWidth);
    case 'card':
      return CARD_WIDTHS[view.card.kind];
    case 'peek':
      return Math.max(notchWidth, 72);
    case 'note':
      return NOTE_WIDTH;
    case 'nudge':
      return NUDGE_WIDTH;
    case 'now':
      return Math.max(NOW_WIDTH, notchWidth + 2 * NOW_WING);
  }
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
  const { gitControl, instructionFiles, secretSend } = approval.payload;
  if (gitControl || instructionFiles || secretSend) return 'open';
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
    .filter((chat) => !chat.archivedAt && needsInput(chat))
    .map((chat): Card => {
      const pending = (approvalsByChat.get(chat.id) ?? []).filter(
        (approval) => approval.status === 'pending',
      );
      const wanted = chat.attention?.approvalId;
      const approval =
        pending.find((candidate) => candidate.id === wanted) ?? pending.at(-1) ?? null;
      return {
        kind: cardKind(chat, approval),
        chat,
        approval,
        loading:
          (chat.sessionType !== 'terminal' || chat.needsInput) && !approvalsByChat.has(chat.id),
      };
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
  if (chat.sessionType === 'terminal' && chat.terminal && !chat.needsInput)
    return terminalMood(chat.terminal.state);
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
    .map((chat) => ({ chat, rank: SESSION_RANK[sessionState(chat)] }))
    .toSorted((a, b) => a.rank - b.rank || b.chat.updatedAt.localeCompare(a.chat.updatedAt))
    .map((item) => item.chat);
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
      (chat) =>
        isRunning(chat) || needsInput(chat) || now - Date.parse(chat.updatedAt) <= ACTIVE_MS,
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { sessions: active.slice(0, PEEK_LIMIT), more: Math.max(0, active.length - PEEK_LIMIT) };
}

const SLOT_GAP = 26;
const NOTCH_CLEARANCE = 38;
const FLAT_SPREAD = 1.25;
const FLAT_BADGE_ROOM = 30;

export function peekClearance(flat: boolean, blob: number): number {
  if (!flat) return NOTCH_CLEARANCE;
  return Math.ceil((blob / 2 + FLAT_BADGE_ROOM) / FLAT_SPREAD);
}

export function peekOffset(slot: number, clearance: number): number {
  const side = slot % 2 === 0 ? 1 : -1;
  return side * (clearance + Math.floor(slot / 2) * SLOT_GAP);
}

export function waitingCount(chats: readonly ConversationSummary[], hidden: ReadonlySet<string>) {
  return chats.filter((chat) => !chat.archivedAt && !hidden.has(chat.id) && needsInput(chat))
    .length;
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
