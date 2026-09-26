import { randomUUID } from 'node:crypto';
import {
  CHECKPOINT_OPTION,
  type Approval,
  type InvolvementLevel,
  type Orchestration,
} from '../../packages/contracts/src/index.ts';
import { createIntakeRecorder } from '../../apps/server/src/advisor/intake-recorder.ts';
import { orchestrate } from '../../apps/server/src/orchestration/orchestrator.ts';
import type { OrchestratorDeps } from '../../apps/server/src/orchestration/session.ts';
import { decideApproval } from '../../apps/server/src/persistence/approvals.ts';
import {
  getConversationDetail,
  sendUserMessage,
} from '../../apps/server/src/persistence/conversations.ts';
import { claimNextJob } from '../../apps/server/src/persistence/jobs.ts';
import { loadOrchestration, waitedMs } from '../../apps/server/src/persistence/orchestrations.ts';
import { getRun, requestCancel } from '../../apps/server/src/persistence/runs.ts';
import { keychainSecretStore } from '../../apps/server/src/setup/secrets.ts';
import { executeChildRun } from '../../apps/server/src/workflow/execute-run.ts';
import { createProviders, type AgentRuntime } from '../../apps/server/src/workflow/providers.ts';
import { linkedConversation } from '../../apps/server/test/approval-support.ts';
import { seedConnections } from '../../apps/server/test/orchestration-live-support.ts';
import { createTestDb, type TestDb } from '../../apps/server/test/support.ts';
import { agentUsage, routingOf } from './metrics.ts';
import type { AgentUsage, AskedItem, BenchMode, Routing } from './results.ts';

export const BENCH_LEVEL: InvolvementLevel = 'full-auto';
export const PINNED = { provider: 'claude', model: 'sonnet', effort: 'medium' } as const;

export interface BenchEnv {
  t: TestDb;
  deps: OrchestratorDeps;
}

export interface LiveCell {
  runId: string;
  status: string;
  error: string | null;
  wallMs: number;
  activeMs: number;
  agents: AgentUsage[];
  retries: number;
  toolCalls: number;
  jevCostUsd: number;
  jevCalls: number;
  asked: AskedItem[];
  routing: Routing | null;
}

export async function startBench(
  perRunCapUsd: number,
  runtime: AgentRuntime = 'acp',
): Promise<BenchEnv> {
  const t = await createTestDb();
  await seedConnections(t);
  const intake = createIntakeRecorder({
    db: t.db,
    secrets: keychainSecretStore(),
    fetch,
    baseUrl: process.env.TYPESAFE_BASE_URL ?? 'https://api.typesafe.ai',
  });
  const deps: OrchestratorDeps = {
    db: t.db,
    providers: createProviders(runtime),
    leaseSeconds: 30,
    approvalPollMs: 200,
    ...(runtime === 'acp' ? { intake } : {}),
    budget: { costCapUsd: perRunCapUsd },
  };
  return { t, deps };
}

export async function stopBench(env: BenchEnv): Promise<void> {
  await env.deps.intake?.settled();
  await env.t.cleanup();
}

const CHECKPOINT_ANSWERS: Record<string, readonly string[]> = {
  clarify: [CHECKPOINT_OPTION.clarifyRules],
  plan: [CHECKPOINT_OPTION.approvePlan],
  retry: [CHECKPOINT_OPTION.finish],
  accept: [CHECKPOINT_OPTION.keep],
  budget: [CHECKPOINT_OPTION.stop],
  merge_conflict: [CHECKPOINT_OPTION.reconcile, CHECKPOINT_OPTION.stop],
};

export function benchAnswer(approval: Approval): { optionId: string; autoDenied: boolean } {
  const preferred = CHECKPOINT_ANSWERS[approval.kind];
  const ids = approval.options.map((option) => option.optionId);
  if (preferred) {
    const optionId = preferred.find((id) => ids.includes(id)) ?? ids[0] ?? CHECKPOINT_OPTION.stop;
    return { optionId, autoDenied: false };
  }
  const deny = approval.options.find((option) => option.kind === 'reject_once');
  return { optionId: deny?.optionId ?? ids.at(-1) ?? 'reject', autoDenied: true };
}

async function answerPending(env: BenchEnv, conversationId: string, asked: AskedItem[]) {
  const detail = await getConversationDetail(env.t.db, conversationId);
  for (const approval of detail?.approvals ?? []) {
    const choice = benchAnswer(approval);
    asked.push({
      kind: approval.kind,
      title: approval.title,
      answer: choice.optionId,
      autoDenied: choice.autoDenied,
    });
    await decideApproval(env.t.db, env.t.workspaceId, approval.id, {
      scope: 'once',
      optionId: choice.optionId,
    });
  }
}

function execute(env: BenchEnv, mode: BenchMode, lease: Parameters<typeof orchestrate>[1]) {
  if (mode === 'harness') return orchestrate(env.deps, lease);
  return executeChildRun(env.deps, lease).then(() => undefined);
}

export async function runLiveCell(
  env: BenchEnv,
  mode: BenchMode,
  repo: string,
  prompt: string,
  timeoutMs: number,
): Promise<LiveCell> {
  const { t } = env;
  const { conversationId } = await linkedConversation(t, repo);
  const routing = mode === 'harness' ? 'auto' : 'pinned';
  await t.db.query('UPDATE conversations SET model_routing = $2 WHERE id = $1', [
    conversationId,
    routing,
  ]);
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: prompt },
    { ...PINNED, permission: 'do', level: BENCH_LEVEL },
  );
  const lease = await claimNextJob(t.db, env.deps.leaseSeconds);
  if (lease?.runId !== sent.run.id) throw new Error('The benchmark could not claim its own run.');
  const started = Date.now();
  let settled = false;
  const work = execute(env, mode, lease).finally(() => {
    settled = true;
  });
  const asked: AskedItem[] = [];
  let cancelled = false;
  while (!settled) {
    await answerPending(env, conversationId, asked);
    if (!cancelled && Date.now() - started > timeoutMs) {
      cancelled = true;
      await requestCancel(t.db, sent.run.id);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await work;
  const wallMs = Date.now() - started;
  return collect(env, sent.run.id, wallMs, asked, cancelled);
}

async function collect(
  env: BenchEnv,
  runId: string,
  wallMs: number,
  asked: AskedItem[],
  timedOut: boolean,
): Promise<LiveCell> {
  const { db } = env.t;
  const run = await getRun(db, runId);
  const orchestration: Orchestration | null = await loadOrchestration(db, runId);
  const agents = await agentUsage(db, runId);
  const waited = await waitedMs(db, runId);
  return {
    runId,
    status: run?.status ?? 'unknown',
    error: timedOut ? 'Timed out and was cancelled.' : (run?.error ?? null),
    wallMs,
    activeMs: Math.max(0, wallMs - waited),
    agents,
    retries: orchestration?.retries ?? 0,
    toolCalls: agents.reduce((sum, agent) => sum + agent.toolCalls, 0),
    jevCostUsd: orchestration?.totals.jevCostUsd ?? 0,
    jevCalls: orchestration?.totals.jevCalls ?? 0,
    asked,
    routing: routingOf(orchestration),
  };
}
