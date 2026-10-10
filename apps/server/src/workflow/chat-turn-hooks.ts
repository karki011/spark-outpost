import type { RunChange } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import type { Lease } from '../persistence/jobs.ts';
import type { Append, RunControl, TurnResult } from './agent-turn.ts';
import type { PublishStepDeps } from './publish-step.ts';
import type { RunInput } from './run-input.ts';

export interface ChatTurnDeps extends PublishStepDeps {
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
  publish?(turn: ChatTurnContext, reply: TurnResult): Promise<TurnResult>;
  changesKept?(turn: ChatTurnContext, files: readonly RunChange[]): Promise<void>;
}
