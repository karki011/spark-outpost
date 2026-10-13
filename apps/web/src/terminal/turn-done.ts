import type { ConversationSummary } from '@spark-outpost/contracts';

const LIVE_RUN = new Set(['queued', 'running', 'awaiting_approval']);

export function terminalKey(chatId: string): string {
  return `terminal:${chatId}`;
}

export function terminalStateEntry(chat: ConversationSummary): [string, string] | null {
  if (chat.sessionType !== 'terminal' || !chat.terminal) return null;
  return [terminalKey(chat.id), chat.terminal.state];
}

export function terminalTurnDone(
  chat: ConversationSummary,
  stateBefore: string | undefined,
  runBefore: string | undefined,
): boolean {
  if (chat.sessionType !== 'terminal' || chat.terminal?.state !== 'ready') return false;
  if (stateBefore !== 'working') return false;
  return !(runBefore !== undefined && LIVE_RUN.has(runBefore));
}

export function terminalTurnFinished(chat: ConversationSummary): boolean {
  return (
    chat.sessionType === 'terminal' &&
    chat.terminal?.state === 'ready' &&
    chat.latestRun?.status === 'succeeded'
  );
}
