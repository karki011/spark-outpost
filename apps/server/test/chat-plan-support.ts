import type { Approval, PlanDocument, PlanLine } from '@spark-outpost/contracts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { planDocuments } from '../src/persistence/plan-documents.ts';
import { chatPlanInput } from '../src/plans/chat-plan-turn.ts';
import { isExitPlanAllow } from '../src/plans/plan-mode.ts';
import { runAgentTurn, startControl } from '../src/workflow/agent-turn.ts';
import { finishRun } from '../src/workflow/execute-run.ts';
import { runAppender } from '../src/workflow/run-appender.ts';
import { runEvents } from '../src/workflow/run-events.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import type { RunTurn } from '../src/workflow/worker.ts';
import type { TestDb } from './support.ts';
import { allowOnce, type Answerer } from './turn-support.ts';

export const planStandInTurn: RunTurn = async (deps, lease) => {
  const input = await chatPlanInput(deps.db, await loadRunInput(deps.db, lease.runId));
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

const offersToLeavePlanMode = (approval: Approval) =>
  approval.options.some((option) => isExitPlanAllow(option.optionId));

export const keepPlanning: Answerer = (approval) =>
  offersToLeavePlanMode(approval) ? { optionId: 'reject' } : allowOnce(approval);

export async function plansOf(
  t: TestDb,
  conversationId: string,
): Promise<{ documents: PlanDocument[]; lines: PlanLine[] }> {
  const detail = await getConversationDetail(t.db, conversationId);
  return {
    documents: await planDocuments(t.db, conversationId),
    lines: detail?.plans?.lines ?? [],
  };
}

interface AgentRequest {
  method: string;
  payload: { params?: Record<string, unknown> };
}

export async function sentToAgent(t: TestDb, runId: string): Promise<AgentRequest[]> {
  const { rows } = await t.db.query<AgentRequest>(
    `SELECT method, payload FROM run_protocol_log
     WHERE run_id = $1 AND direction = 'to_agent' AND kind = 'request' ORDER BY seq`,
    [runId],
  );
  return rows;
}

export function planModeSetBeforePrompt(requests: readonly AgentRequest[]): boolean {
  const set = requests.findIndex(
    (request) =>
      request.method === 'session/set_config_option' && request.payload.params?.value === 'plan',
  );
  const prompt = requests.findIndex((request) => request.method === 'session/prompt');
  return set >= 0 && set < prompt;
}

export async function runMode(t: TestDb, runId: string): Promise<string | null> {
  const { rows } = await t.db.query<{ mode: string | null }>(
    'SELECT mode FROM runs WHERE id = $1',
    [runId],
  );
  return rows[0]?.mode ?? null;
}
