import type { RunChange } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import type { Lease } from '../persistence/jobs.ts';
import type { Append, RunControl, TurnDeps, TurnResult } from './agent-turn.ts';
import type { RunInput } from './run-input.ts';

export interface ChatTurnDeps extends TurnDeps {
  branchPrefix?: string;
  checkpointTimeoutMs?: number;
}

export interface ChatTurnContext {
  deps: ChatTurnDeps;
  lease: Lease;
  input: RunInput;
  append: Append;
  control: RunControl;
}

export interface ChatTurnHooks {
  planTurn?(db: Db, input: RunInput): Promise<RunInput>;
  changesKept?(turn: ChatTurnContext, files: readonly RunChange[]): Promise<void>;
  publish?(turn: ChatTurnContext, reply: TurnResult): Promise<TurnResult>;
}
