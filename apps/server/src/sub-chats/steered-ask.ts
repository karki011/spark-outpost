import type { ChatAsk, MemberMessage } from '@spark-outpost/contracts';
import { chatAsksById, markChatAskDelivered } from '../persistence/chat-asks.ts';
import type { Db } from '../persistence/db.ts';
import type { Observation } from '../persistence/observations.ts';
import { askPromptFacts } from './asks.ts';
import { steeredAskPrompt } from './message-prompt.ts';

export const STEERED_ASK_OBSERVATION: Observation = {
  source: 'private_data',
  label: 'private work data (message from another chat)',
};

export type RecordObservation = (observation: Observation) => void;

export interface SteeredAsks {
  among(messages: readonly MemberMessage[]): Promise<ReadonlyMap<string, ChatAsk>>;
  prompt(ask: ChatAsk): Promise<string>;
  delivered(asks: readonly ChatAsk[]): Promise<void>;
}

export function steeredAsks(db: Db, topRunId: string, record?: RecordObservation): SteeredAsks {
  return {
    among: (messages) =>
      chatAsksById(
        db,
        messages.map((message) => message.id),
      ),
    prompt: async (ask) => steeredAskPrompt(await askPromptFacts(db, ask), ask.body),
    async delivered(asks) {
      if (asks.length === 0) return;
      record?.(STEERED_ASK_OBSERVATION);
      for (const ask of asks) await markChatAskDelivered(db, ask.id, 'steer', topRunId);
    },
  };
}
