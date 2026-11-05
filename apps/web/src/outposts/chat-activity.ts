import type { ConversationSummary } from '@spark-outpost/contracts';
import { rowState } from '../conversations/row-state.ts';

export function chatActivity(chats: readonly ConversationSummary[]): ReadonlyMap<string, string> {
  const doing = new Map<string, string>();
  for (const chat of chats) {
    const state = rowState(chat, false);
    if (state.tone === 'running' && state.sub) doing.set(chat.id, state.sub);
  }
  return doing;
}
