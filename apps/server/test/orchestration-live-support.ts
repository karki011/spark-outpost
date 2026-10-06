import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHECKPOINT_OPTION,
  clarifyOptionId,
  type Approval,
  type InvolvementLevel,
  type Orchestration,
} from '@spark-outpost/contracts';
import { createIntakeRecorder } from '../src/advisor/intake-recorder.ts';
import type { OrchestratorDeps } from '../src/orchestration/session.ts';
import { decideApproval } from '../src/persistence/approvals.ts';
import { getConversationDetail, sendUserMessage } from '../src/persistence/conversations.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { saveConnection } from '../src/persistence/setup.ts';
import { keychainSecretStore } from '../src/setup/secrets.ts';
import { createProviders } from '../src/workflow/providers.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { linkedConversation } from './approval-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const CLAUDE_MODELS = [
  { id: 'default', label: 'Default (recommended)', description: 'Opus (1M context)' },
  {
    id: 'opus[1m]',
    label: 'Opus 5.5',
    description: 'Opus 5.5 with 1M context · Best for everyday, complex tasks',
  },
  {
    id: 'claude-fable-5-1[1m]',
    label: 'Fable 5.1',
    description: 'Fable 5.1 · Most capable for your hardest and longest-running tasks',
  },
  { id: 'sonnet', label: 'Sonnet 5', description: 'Sonnet 5 · Efficient for routine tasks' },
  { id: 'haiku', label: 'Haiku 4.5', description: 'Haiku 4.5 · Fastest for quick answers' },
];
const CODEX_MODELS = [
  {
    id: 'gpt-6-astra',
    label: '6 Astra',
    description: 'Frontier intelligence for the most demanding work.',
  },
  { id: 'gpt-6-sol', label: '6 Sol', description: 'Workhorse model for coding and everyday work.' },
  { id: 'gpt-6-luna', label: '6 Luna', description: 'Fast and affordable model for easier tasks.' },
];

export const live: { t: TestDb; base: string; worker: Worker } = {
  t: undefined as unknown as TestDb,
  base: '',
  worker: undefined as unknown as Worker,
};

export async function seedConnections(t: TestDb) {
  for (const [provider, models, model] of [
    ['claude', CLAUDE_MODELS, 'sonnet'],
    ['codex', CODEX_MODELS, 'gpt-6-sol'],
  ] as const) {
    await saveConnection(t.db, t.workspaceId, provider, {
      method: 'cli',
      detail: 'live',
      summary: '',
      models: [],
    });
    await t.db.query(
      'UPDATE provider_connections SET model = $3, effort = $4 WHERE workspace_id = $1 AND provider = $2',
      [t.workspaceId, provider, model, 'medium'],
    );
    await t.db.query(
      `INSERT INTO provider_capabilities (workspace_id, provider, models, efforts, default_model)
       VALUES ($1, $2, $3, '[]', $4) ON CONFLICT (workspace_id, provider) DO NOTHING`,
      [t.workspaceId, provider, JSON.stringify(models), model],
    );
  }
  await t.db.query(
    `INSERT INTO advisor_connections (workspace_id, advisor, method, detail, models, model, verified_at)
     VALUES ($1, 'jev', 'api_key', 'live', '[]', 'jev-latest', now())`,
    [t.workspaceId],
  );
}

export async function startLive(deps: Partial<OrchestratorDeps> = {}): Promise<void> {
  live.t = await createTestDb();
  const parent = process.env.SPARK_LIVE_DIR ?? tmpdir();
  await mkdir(parent, { recursive: true });
  live.base = await realpath(await mkdtemp(join(parent, 'spark-live-orchestration-')));
  await seedConnections(live.t);
  const intake = createIntakeRecorder({
    db: live.t.db,
    secrets: keychainSecretStore(),
    fetch,
    baseUrl: process.env.TYPESAFE_BASE_URL ?? 'https://api.typesafe.ai',
  });
  live.worker = startWorker({
    db: live.t.db,
    providers: createProviders('acp'),
    leaseSeconds: 30,
    concurrency: 2,
    pollMs: 100,
    approvalPollMs: 200,
    intake,
    ...deps,
  });
}

export async function stopLive(): Promise<void> {
  await live.worker.stop();
  await live.t.cleanup();
  await rm(live.base, { recursive: true, force: true });
}

export async function repoWith(name: string, files: Record<string, string>): Promise<string> {
  const repo = join(live.base, name);
  await mkdir(repo, { recursive: true });
  for (const [file, content] of Object.entries(files)) await writeFile(join(repo, file), content);
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args]);
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
  return repo;
}

export function answer(approval: Approval): { optionId: string } {
  if (approval.kind === 'clarify') return { optionId: clarifyOptionId(0) };
  if (approval.kind === 'plan') return { optionId: CHECKPOINT_OPTION.approvePlan };
  if (approval.kind === 'retry') return { optionId: CHECKPOINT_OPTION.finish };
  if (approval.kind === 'accept') return { optionId: CHECKPOINT_OPTION.keep };
  const command = approval.payload.command ?? '';
  const pick = /\bpush\b/.test(command) ? 'reject_once' : 'allow_once';
  return { optionId: approval.options.find((option) => option.kind === pick)!.optionId };
}

export interface LiveRun {
  orchestration: Orchestration;
  asked: string[];
  elapsedMs: number;
  reply: string | undefined;
}

export async function runLive(
  repo: string,
  content: string,
  level: InvolvementLevel,
  onTick: (view: Orchestration | null) => Promise<void> = async () => undefined,
): Promise<LiveRun> {
  const { t } = live;
  const { conversationId } = await linkedConversation(t, repo);
  await t.db.query(`UPDATE conversations SET model_routing = 'auto' WHERE id = $1`, [
    conversationId,
  ]);
  const started = Date.now();
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    { provider: 'claude', model: 'sonnet', effort: 'medium', permission: 'do', level },
  );
  const asked: string[] = [];
  for (let tick = 0; tick < 3_000; tick++) {
    const detail = await getConversationDetail(t.db, conversationId);
    const pending = (detail?.approvals ?? []).filter((approval) => approval.status === 'pending');
    for (const approval of pending) {
      const choice = answer(approval);
      asked.push(`${approval.kind}: ${approval.title} -> ${choice.optionId}`);
      await decideApproval(t.db, t.workspaceId, approval.id, { scope: 'once', ...choice });
    }
    await onTick(await loadOrchestration(t.db, sent.run.id));
    if ((await getRun(t.db, sent.run.id))?.finishedAt) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const orchestration = (await loadOrchestration(t.db, sent.run.id))!;
  const detail = await getConversationDetail(t.db, conversationId);
  const result = {
    orchestration,
    asked,
    elapsedMs: Date.now() - started,
    reply: detail?.messages.find((message) => message.role === 'assistant')?.content,
  };
  report(content, result);
  return result;
}

export function report(content: string, run: LiveRun) {
  const { orchestration } = run;
  console.log(
    JSON.stringify(
      {
        request: content,
        status: orchestration.status,
        error: orchestration.error,
        depth: orchestration.depth,
        depthSource: orchestration.depthSource,
        risk: orchestration.risk,
        planVersion: orchestration.planVersion,
        elapsedMs: run.elapsedMs,
        crew: orchestration.crew.map((member) => ({
          label: member.agentLabel,
          provider: member.provider,
          model: member.model,
          effort: member.effort,
          routedBy: member.routedBy,
          status: member.status,
          tokens: member.tokens,
          costUsd: member.costUsd,
          costSource: member.costSource,
          durationMs: member.durationMs,
          toolCalls: member.toolCalls,
          verdict: member.verdict,
          quality: member.quality,
        })),
        asked: run.asked,
        decisions: orchestration.decisions.map((decision) => ({
          kind: decision.kind,
          role: decision.role,
          summary: decision.summary,
          applied: decision.applied,
          gate: decision.gate?.decision ?? null,
          confidence: decision.gate?.confidence ?? null,
          jevStatus: decision.jevStatus,
          latencyMs: decision.latencyMs,
          costUsd: decision.costUsd,
        })),
        totals: orchestration.totals,
        reply: run.reply?.slice(0, 600),
      },
      null,
      2,
    ),
  );
}
