import { runAgentTurn, startControl } from '../src/workflow/agent-turn.ts';
import { finishRun } from '../src/workflow/execute-run.ts';
import { runAppender } from '../src/workflow/run-appender.ts';
import { runEvents } from '../src/workflow/run-events.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import type { RunTurn } from '../src/workflow/worker.ts';

export const standInTurn: RunTurn = async (deps, lease) => {
  const input = await loadRunInput(deps.db, lease.runId);
  const append = runAppender(deps.db, lease);
  const control = startControl(deps, lease);
  try {
    await append(runEvents.started(input.identity), { transition: { status: 'running' } });
    const result = await runAgentTurn(deps, lease, input, append, control);
    await finishRun(append, input.identity, result, true);
  } finally {
    control.dispose();
  }
};
