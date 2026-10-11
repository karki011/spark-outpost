import type { ChatUpdate, JevStatus } from '@spark-outpost/contracts';
import type { IntakeDeps } from '../advisor/jev-types.ts';
import { COORD_POLICY_VERSION } from '../advisor/policy.ts';
import { callJev, type JevAccess, type JevCall } from '../advisor/jev-calls.ts';
import type { Queryable } from '../persistence/db.ts';
import { insertDecision } from '../persistence/orchestrations.ts';
import { advisorEntry } from '../providers/catalog.ts';
import { loadChatFacts } from './update-facts.ts';
import {
  asksJev,
  composeUpdate,
  pickUpdate,
  updatePlan,
  updateQuestions,
  type UpdatePick,
  type UpdatePlan,
} from './update-summary.ts';

export const CHAT_UPDATE_JEV_TIMEOUT_MS = 4_000;

export interface ChatUpdateDeps {
  db: Queryable;
  workspaceId: string;
  jev: IntakeDeps | null;
  now?: () => Date;
}

async function jevAccess(deps: ChatUpdateDeps): Promise<JevAccess | null> {
  if (!deps.jev) return null;
  const { rows } = await deps.db.query<{ model: string | null }>(
    `SELECT model FROM advisor_connections
     WHERE workspace_id = $1 AND advisor = 'jev' AND disconnected_at IS NULL`,
    [deps.workspaceId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    deps: { ...deps.jev, timeoutMs: CHAT_UPDATE_JEV_TIMEOUT_MS },
    model: row.model ?? advisorEntry('jev').defaultModel,
  };
}

function statusOf(access: JevAccess | null, call: JevCall | null): JevStatus {
  if (call) return call.status;
  return access ? 'not_asked' : 'not_connected';
}

async function record(
  deps: ChatUpdateDeps,
  runId: string,
  plan: UpdatePlan,
  pick: UpdatePick,
  lines: readonly string[],
  status: JevStatus,
  call: JevCall | null,
): Promise<void> {
  await insertDecision(deps.db, {
    runId,
    purpose: 'chat_update',
    childRunId: null,
    role: null,
    stepIndex: null,
    jevStatus: status,
    inputTokens: call?.usage?.inputTokens ?? null,
    costUsd: call?.usage?.costUsd ?? null,
    policyVersion: COORD_POLICY_VERSION,
    body: {
      summary: lines.join(' '),
      applied: pick.byJev ? 'jev' : 'rules',
      gate: null,
      jevError: call?.error ?? null,
      jevModel: call?.model ?? null,
      latencyMs: call?.latencyMs ?? null,
      answer: { rules: plan.rules, picked: { headline: pick.headline, next: pick.next } },
      state: call?.asked?.state ?? null,
      questions: call?.asked ? Object.keys(call.asked.questions) : null,
      answers: call?.response?.answers ?? null,
    },
  });
}

export async function chatUpdate(
  deps: ChatUpdateDeps,
  conversationId: string,
): Promise<ChatUpdate | null> {
  const now = deps.now?.() ?? new Date();
  const loaded = await loadChatFacts(deps.db, deps.workspaceId, conversationId, now);
  if (!loaded) return null;
  const { facts, runId } = loaded;
  const plan = updatePlan(facts);
  const access = runId ? await jevAccess(deps) : null;
  const call =
    access && asksJev(plan)
      ? await callJev(access, () => updateQuestions(facts, plan), new AbortController().signal)
      : null;
  const pick = pickUpdate(plan, call?.response ?? null);
  const lines = composeUpdate(facts, pick);
  if (runId) {
    await record(deps, runId, plan, pick, lines, statusOf(access, call), call).catch(
      (error: unknown) => console.error('Could not record the chat update', error),
    );
  }
  return {
    conversationId,
    lines,
    by: pick.byJev ? 'jev' : 'rules',
    createdAt: now.toISOString(),
  };
}
