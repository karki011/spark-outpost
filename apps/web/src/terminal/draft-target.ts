import type { InsertKind } from './selection/selection-text.ts';

export const TERMINAL_NOT_RUNNING =
  'The terminal isn’t running, so this wasn’t added. Start or resume the session, then try again.';
export const TERMINAL_NO_INPUT =
  'The terminal can’t take input right now, so this wasn’t added. Reconnect it, then try again.';
export const TERMINAL_WAITING =
  'The agent is waiting for your answer in the terminal, so this wasn’t added. Answer it, then try again.';

export interface TerminalDraftTarget {
  refusal(): string | null;
  insert(kind: InsertKind, text: string): boolean;
}

const targets = new Map<string, TerminalDraftTarget>();

export function setDraftTarget(chatId: string, target: TerminalDraftTarget): () => void {
  targets.set(chatId, target);
  return () => {
    if (targets.get(chatId) === target) targets.delete(chatId);
  };
}

export function draftTarget(chatId: string): TerminalDraftTarget | null {
  return targets.get(chatId) ?? null;
}
