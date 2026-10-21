import {
  approvalAttentionKey,
  type Approval,
  type ConversationSummary,
} from '@spark-outpost/contracts';
import { terminalMood } from '../terminal/native-state.ts';
import {
  terminalStateEntry,
  terminalKey,
  terminalTurnDone,
  terminalTurnFinished,
} from '../terminal/turn-done.ts';
import { needsInput, rowState } from '../conversations/row-state.ts';

export type Panel = 'home' | 'quick' | 'ask';

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
  strip: boolean;
}

export type IslandView =
  | { kind: 'note' }
  | { kind: 'panel'; panel: Panel }
  | { kind: 'card'; card: Card; index: number; total: number }
  | { kind: 'now' }
  | { kind: 'peek' };

export function islandView(inputs: IslandInputs): IslandView {
  if (inputs.note) return { kind: 'note' };
  if (inputs.panel) return { kind: 'panel', panel: inputs.panel };
  const total = inputs.cards.length;
  const reviewed = inputs.cards.findIndex((card) => card.chat.id === inputs.review);
  if (reviewed >= 0) {
    return { kind: 'card', card: inputs.cards[reviewed]!, index: reviewed + 1, total };
  }
  return inputs.strip ? { kind: 'now' } : { kind: 'peek' };
}

export type QuickShortcutTarget =
  { kind: 'review'; chatId: string } | { kind: 'close' } | { kind: 'quick' };

export function quickShortcutTarget(
  panel: Panel | null,
  view: IslandView,
  pending: Card | null = null,
): QuickShortcutTarget {
  if (panel) return { kind: 'close' };
  const card = view.kind === 'card' ? view.card : view.kind === 'note' ? null : pending;
  if (!card) return { kind: 'quick' };
  if (card.loading || card.kind === 'approval' || card.kind === 'force') {
    return { kind: 'review', chatId: card.chat.id };
  }
  return { kind: 'quick' };
}

export function hoverOpensHome(view: IslandView): boolean {
  return view.kind === 'peek';
}

const CARD_WIDTHS = {
  approval: 556,
  force: 556,
  question: 556,
  open: 520,
} as const;
const NOTE_WIDTH = 420;
const NOW_WIDTH = 460;
const NOW_WING = 104;
const HOME_WIDTH = { share: 0.42, min: 640, max: 760 } as const;
const PANEL_WIDTH = { share: 0.42, min: 640, max: 760 } as const;

function scaled(screenWidth: number, range: { share: number; min: number; max: number }): number {
  return Math.round(Math.min(range.max, Math.max(range.min, screenWidth * range.share)));
}

export function panelWidth(panel: Panel, screenWidth: number): number {
  return scaled(screenWidth, panel === 'home' ? HOME_WIDTH : PANEL_WIDTH);
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
    case 'now':
      return Math.max(NOW_WIDTH, notchWidth + 2 * NOW_WING);
  }
}

export type RunStatuses = ReadonlyMap<string, { status: string; chatId: string }>;

type RunStatusEntry = [string, { status: string; chatId: string }];

export function runStatuses(chats: readonly ConversationSummary[]): RunStatuses {
  return new Map(
    chats.flatMap((chat): RunStatusEntry[] => {
      const run = chat.latestRun;
      const terminal = terminalStateEntry(chat);
      const entries: RunStatusEntry[] = [];
      if (run) entries.push([run.id, { status: run.status, chatId: chat.id }]);
      if (terminal) entries.push([terminal[0], { status: terminal[1], chatId: chat.id }]);
      return entries;
    }),
  );
}

const LIVE = new Set(['queued', 'running', 'awaiting_approval']);

export function newMoments(previous: RunStatuses, chats: readonly ConversationSummary[]): Moment[] {
  return chats.flatMap((chat): Moment[] => {
    const run = chat.latestRun;
    const runBefore = run ? previous.get(run.id)?.status : undefined;
    if (terminalTurnDone(chat, previous.get(terminalKey(chat.id))?.status, runBefore))
      return [{ kind: 'done', chatId: chat.id, runId: run?.id ?? chat.terminal!.id }];
    if (!run || !runBefore || !LIVE.has(runBefore)) return [];
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
    .sort((a, b) => cardTime(a).localeCompare(cardTime(b)));
}

function cardTime(card: Card): string {
  return card.approval?.createdAt ?? card.chat.updatedAt;
}

export function cardKey(card: Card): string {
  return card.approval
    ? approvalAttentionKey(card.approval.id)
    : `chat:${card.chat.id}:${card.chat.updatedAt}`;
}

export type SessionState = 'working' | 'waiting' | 'done' | 'failed' | 'idle';

export function sessionState(chat: ConversationSummary): SessionState {
  if (chat.sessionType === 'terminal' && chat.terminal && !chat.needsInput)
    return terminalTurnFinished(chat) ? 'done' : terminalMood(chat.terminal.state);
  const tone = rowState(chat, false).tone;
  if (tone === 'permission' || tone === 'asking') return 'waiting';
  if (tone === 'running') return 'working';
  if (tone === 'error') return 'failed';
  if (chat.latestRun?.status === 'succeeded') return 'done';
  return 'idle';
}
