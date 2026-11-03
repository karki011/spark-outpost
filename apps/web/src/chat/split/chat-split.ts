import {
  CHAT_LIST_PAGE,
  SPLIT_RATIO_DEFAULT,
  SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN,
  type ConversationSummary,
} from '@spark-outpost/contracts';

export type PaneSide = 'primary' | 'secondary';

export interface ChatSplit {
  primary: string | null;
  secondary: string | null;
  focus: PaneSide;
  ratio: number;
}

export const NO_SPLIT: ChatSplit = {
  primary: null,
  secondary: null,
  focus: 'primary',
  ratio: SPLIT_RATIO_DEFAULT,
};

const STORAGE_KEY = 'spark-outpost.chat-split';
const ID_MAX = 100;

function sideOf(split: ChatSplit, id: string): PaneSide | null {
  if (id === split.primary) return 'primary';
  if (id === split.secondary) return 'secondary';
  return null;
}

function otherSide(side: PaneSide): PaneSide {
  return side === 'primary' ? 'secondary' : 'primary';
}

export function focusPane(split: ChatSplit, side: PaneSide): ChatSplit {
  if (split.focus === side || (side === 'secondary' && split.secondary === null)) return split;
  return { ...split, focus: side };
}

export function showChat(split: ChatSplit, id: string, narrow: boolean): ChatSplit {
  if (narrow) {
    const secondary = split.secondary === id ? null : split.secondary;
    return { ...split, primary: id, secondary, focus: 'primary' };
  }
  const shown = sideOf(split, id);
  if (shown) return focusPane(split, shown);
  if (split.secondary === null) return { ...split, primary: id, focus: 'primary' };
  return { ...split, [split.focus]: id };
}

export function openBeside(split: ChatSplit, id: string, current: string | null): ChatSplit {
  const anchored = { ...split, primary: split.primary ?? current };
  const shown = sideOf(anchored, id);
  if (shown) return focusPane(anchored, shown);
  if (anchored.primary === null) return { ...anchored, primary: id, focus: 'primary' };
  const side = anchored.secondary === null ? 'secondary' : otherSide(anchored.focus);
  return { ...anchored, [side]: id, focus: side };
}

export function closePane(split: ChatSplit, side: PaneSide): ChatSplit {
  if (split.secondary === null) return split;
  const primary = side === 'primary' ? split.secondary : split.primary;
  return { ...split, primary, secondary: null, focus: 'primary' };
}

export function leaveChat(split: ChatSplit, id: string): ChatSplit | null {
  if (split.secondary === null) return null;
  const side = sideOf(split, id);
  return side ? closePane(split, side) : null;
}

function gone(chats: readonly ConversationSummary[], id: string | null): boolean {
  if (id === null) return true;
  const chat = chats.find((candidate) => candidate.id === id);
  if (chat) return Boolean(chat.archivedAt);
  return chats.length < CHAT_LIST_PAGE;
}

export function restoredSplit(split: ChatSplit, chats: readonly ConversationSummary[]): ChatSplit {
  if (split.secondary === null) return split;
  if (gone(chats, split.secondary)) return closePane(split, 'secondary');
  if (gone(chats, split.primary)) return closePane(split, 'primary');
  return split;
}

function chatId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= ID_MAX ? value : null;
}

function savedRatio(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SPLIT_RATIO_DEFAULT;
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, value));
}

export function parseSplit(value: unknown): ChatSplit {
  if (typeof value !== 'object' || value === null) return NO_SPLIT;
  const saved = value as Record<string, unknown>;
  const ratio = savedRatio(saved.ratio);
  const primary = chatId(saved.primary);
  const secondary = chatId(saved.secondary);
  if (primary === null || secondary === null || primary === secondary) {
    return { ...NO_SPLIT, ratio };
  }
  const focus = saved.focus === 'secondary' ? 'secondary' : 'primary';
  return { primary, secondary, focus, ratio };
}

export function readSavedSplit(): ChatSplit {
  try {
    return parseSplit(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return NO_SPLIT;
  }
}

export function saveSplit(split: ChatSplit): void {
  const saved = split.secondary === null ? { ratio: split.ratio } : split;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    return;
  }
}
