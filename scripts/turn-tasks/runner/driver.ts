import type { Db } from '../../../apps/server/src/persistence/db.ts';
import type { Approval } from '../../../packages/contracts/src/index.ts';
import type { ModeChoice } from '../tasks/types.ts';
import type { Provider } from './providers.ts';

export const AUTONOMY_LEVEL = 'hands-off';
export const DEFAULT_EFFORT = 'high';

export interface ChatSetup {
  model: string;
  effort: string;
  agentMode: string;
}

export interface Chat {
  conversationId: string;
  repo: string;
}

export interface TurnDriver {
  readonly provider: Provider;
  readonly db: Db;
  setupFor(mode: ModeChoice): ChatSetup;
  openChat(repo: string, setup: ChatSetup): Promise<Chat>;
  send(chat: Chat, text: string): Promise<string>;
  finished(runId: string): Promise<boolean>;
  pending(chat: Chat): Promise<Approval[]>;
  decide(approval: Approval, optionId: string): Promise<void>;
  cancel(runId: string): Promise<void>;
  close(): Promise<void>;
}
