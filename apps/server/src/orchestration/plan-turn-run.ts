import type { Lease } from '../persistence/jobs.ts';
import { asPlanTurn, markPlanTurn } from '../plans/simple-plan-turn.ts';
import { runAgentTurn, type Append, type RunControl } from '../workflow/agent-turn.ts';
import { finishRun } from '../workflow/execute-run.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { placeChatOrStop } from './chat-place.ts';
import type { OrchestratorDeps } from './session.ts';

export async function runPlanTurn(
  deps: OrchestratorDeps,
  lease: Lease,
  input: RunInput,
  append: Append,
  control: RunControl,
): Promise<void> {
  await markPlanTurn(deps.db, lease.runId);
  const placed = await placeChatOrStop(deps, asPlanTurn(input), append, true, lease);
  if (!placed) return;
  const result = await runAgentTurn(deps, lease, placed.input, append, control);
  await finishRun(append, placed.input.identity, result, true);
}
