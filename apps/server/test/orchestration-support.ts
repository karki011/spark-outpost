import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHECKPOINT_OPTION,
  clarifyOptionId,
  type Approval,
  type Depth,
  type InvolvementLevel,
  type Orchestration,
  type Risk,
} from '@spark-outpost/contracts';
import { createIntakeRecorder } from '../src/advisor/intake-recorder.ts';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { decideApproval } from '../src/persistence/approvals.ts';
import { getConversationDetail, sendUserMessage } from '../src/persistence/conversations.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { getRun } from '../src/persistence/runs.ts';
import type { Provider } from '../src/providers/provider.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { linkedConversation } from './approval-support.ts';
import { eventually, type TestDb } from './support.ts';

export const CLAUDE_MODELS = [
  { id: 'haiku', label: 'Haiku 4.5', description: 'Fastest for quick answers' },
  { id: 'sonnet', label: 'Sonnet 5', description: 'Efficient for routine tasks' },
  { id: 'opus[1m]', label: 'Opus 5.5', description: 'Best for complex tasks' },
];
export const CODEX_MODELS = [
  { id: 'gpt-6-astra', label: '6 Astra', description: 'Frontier' },
  { id: 'gpt-6-sol', label: '6 Sol', description: 'Workhorse' },
  { id: 'gpt-6-luna', label: '6 Luna', description: 'Fast' },
];
const EFFORTS = ['low', 'medium', 'high'].map((id) => ({ id, label: id, description: null }));

export async function connectProviders(t: TestDb, jev = true): Promise<void> {
  for (const [provider, models, model] of [
    ['claude', CLAUDE_MODELS, 'sonnet'],
    ['codex', CODEX_MODELS, 'gpt-6-sol'],
  ] as const) {
    await t.db.query(
      `INSERT INTO provider_connections
         (workspace_id, provider, method, detail, models, model, permission, effort, verified_at)
       VALUES ($1, $2, 'cli', 'test', '[]', $3, 'ask', 'medium', now())`,
      [t.workspaceId, provider, model],
    );
    await t.db.query(
      `INSERT INTO provider_capabilities (workspace_id, provider, models, efforts, default_model)
       VALUES ($1, $2, $3, $4, $5)`,
      [t.workspaceId, provider, JSON.stringify(models), JSON.stringify(EFFORTS), model],
    );
  }
  if (!jev) return;
  await t.db.query(
    `INSERT INTO advisor_connections
       (workspace_id, advisor, method, detail, models, model, verified_at)
     VALUES ($1, 'jev', 'api_key', '…test', '[]', 'jev-latest', now())`,
    [t.workspaceId],
  );
}

const launch = {
  command: process.execPath,
  args: ['--import', import.meta.resolve('tsx'), join(import.meta.dirname, 'fake-acp-agent.ts')],
};

function sessionEnv(store: string | undefined): Record<string, string> {
  if (!store) return {};
  return {
    FAKE_ACP_SESSION_STORE: store,
    FAKE_ACP_SESSION_CAPABILITIES: JSON.stringify({ resume: {}, close: {} }),
  };
}

function fakeAgent(id: 'claude' | 'codex', models: typeof CLAUDE_MODELS, store?: string): Provider {
  return createAcpProvider({
    definition: { ...agentDefinitions[id], conversationMode: 'read-only' },
    launch,
    cancelGraceMs: 2_000,
    env: {
      ...(process.env as Record<string, string>),
      FAKE_ACP_MODELS: JSON.stringify(models.map((model) => [model.id, model.label])),
      ...sessionEnv(store),
    },
  });
}

export interface Scenario {
  id: string;
  text: string;
  mode: 'ask' | 'do';
  depth: Depth;
  risk: Risk;
  confidence: number;
  model: string;
  effort: number;
  scope?: string;
  scopeConfidence?: number;
  complexity?: number;
  intent?: string;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'question',
    text: 'What does parseDate do?',
    mode: 'ask',
    depth: 'direct',
    risk: 'read-only',
    confidence: 0.94,
    model: 'sonnet',
    effort: 0,
  },
  {
    id: 'trivial',
    text: 'Fix the typo in the README heading. #build',
    mode: 'do',
    depth: 'execute',
    risk: 'edits',
    confidence: 0.92,
    model: 'haiku',
    effort: 0,
  },
  {
    id: 'normal',
    text: 'The divider shows the wrong day after midnight. Fix it and add a test. #build',
    mode: 'do',
    depth: 'execute',
    risk: 'edits',
    confidence: 0.81,
    model: 'sonnet',
    effort: 1,
  },
  {
    id: 'complex',
    text: 'Move date handling into one module and update every component. #build',
    mode: 'do',
    depth: 'plan_execute_review',
    risk: 'multi-file',
    confidence: 0.77,
    model: 'sonnet',
    effort: 1,
  },
  {
    id: 'risky',
    text: 'Rename the runs table column and migrate old rows. #build',
    mode: 'do',
    depth: 'plan_execute_review',
    risk: 'destructive',
    confidence: 0.71,
    model: 'opus[1m]',
    effort: 2,
  },
];

export const LEVELS: readonly InvolvementLevel[] = [
  'hands-on',
  'balanced',
  'hands-off',
  'full-auto',
];

const RISKS: Risk[] = ['read-only', 'edits', 'multi-file', 'destructive'];

type Answers = Record<string, unknown>;

function choice(value: string, confidence: number, second?: string): Answers[string] {
  const probabilities: Record<string, number> = { [value]: confidence };
  if (second) probabilities[second] = 1 - confidence;
  return { type: 'choice', choice: value, probabilities, confidence };
}

const score = (value: number, confidence = 0.9) => ({ type: 'score', score: value, confidence });

export interface ArchitectAnswer {
  model: string;
  effort: number;
  confidence: number;
}

export interface JevScript {
  calls: { questions: string[]; state: Record<string, unknown> }[];
  scenario?: Scenario;
  architect?: ArchitectAnswer;
  parallel?: Record<string, number>;
  transition?: (
    state: Record<string, unknown>,
    offered: string[],
  ) => { status: string; next: string; confidence?: number };
}

function intakeAnswers(scenario: Scenario): Answers {
  const second = scenario.depth === 'plan_execute_review' ? 'plan_execute' : 'execute';
  return {
    intent: choice(
      scenario.intent ?? (scenario.mode === 'ask' ? 'question' : 'bug_fix'),
      scenario.confidence,
    ),
    complexity: score(scenario.complexity ?? 1),
    risk: score(RISKS.indexOf(scenario.risk)),
    depth: choice(scenario.depth, scenario.confidence, second),
    ...(scenario.scope ? { scope: choice(scenario.scope, scenario.scopeConfidence ?? 0.9) } : {}),
    provider: choice('claude', 0.95),
    model_claude: choice(scenario.model, 0.95),
    effort_claude: score(scenario.effort),
    model_codex: choice('gpt-6-sol', 0.95),
    effort_codex: score(1),
  };
}

const UNSURE_ARCHITECT: ArchitectAnswer = { model: 'sonnet', effort: 1, confidence: 0.45 };

function routeAnswers(script: JevScript, questions: Record<string, unknown>): Answers {
  const answers: Answers = {};
  const architect = script.architect ?? UNSURE_ARCHITECT;
  for (const key of Object.keys(questions)) {
    if (key === 'model_architect_0') answers[key] = choice(architect.model, architect.confidence);
    else if (key === 'effort_architect_0') answers[key] = score(architect.effort);
    else if (key.startsWith('model_critic')) answers[key] = choice('gpt-6-sol', 0.95);
    else if (key.startsWith('model_')) answers[key] = choice('sonnet', 0.95);
    else answers[key] = score(key.startsWith('effort_critic') ? 2 : 1);
  }
  return answers;
}

const isParallelKey = (key: string) => key.startsWith('independent_') || key.startsWith('large_');

function parallelAnswers(script: JevScript, questions: Record<string, unknown>): Answers {
  return Object.fromEntries(
    Object.keys(questions).flatMap((key) =>
      script.parallel?.[key] === undefined
        ? []
        : [[key, { type: 'noul', noul: script.parallel[key] }]],
    ),
  );
}

function transitionAnswers(
  script: JevScript,
  state: Record<string, unknown>,
  questions: Record<string, { criteria?: Record<string, string> }>,
): Answers {
  const offered = Object.keys(questions.next?.criteria ?? {});
  const scripted = script.transition?.(state, offered);
  const fallback = offered.includes('next_step') ? 'next_step' : 'finish';
  const next = scripted && offered.includes(scripted.next) ? scripted.next : fallback;
  return {
    status: choice(scripted?.status ?? 'done', scripted?.confidence ?? 0.95),
    quality: score(3),
    next: choice(next, scripted?.confidence ?? 0.95),
  };
}

export function jevFetch(script: JevScript): typeof fetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      state: Record<string, unknown>;
      questions: Record<string, { criteria?: Record<string, string> }>;
    };
    script.calls.push({ questions: Object.keys(body.questions), state: body.state });
    const task = String(body.state.task ?? '');
    const scenario =
      script.scenario ??
      SCENARIOS.find((candidate) => task.startsWith(candidate.text)) ??
      SCENARIOS[0]!;
    const answers = body.questions.intent
      ? intakeAnswers(scenario)
      : body.questions.status
        ? transitionAnswers(script, body.state, body.questions)
        : Object.keys(body.questions).some(isParallelKey)
          ? parallelAnswers(script, body.questions)
          : routeAnswers(script, body.questions);
    return new Response(
      JSON.stringify({
        model: 'jev-test',
        answers,
        usage: { input_tokens: 1000, output_tokens: 0 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
}

export interface Harness {
  worker: Worker;
  stop(): Promise<void>;
}

export function startOrchestrator(
  t: TestDb,
  fetcher: typeof fetch | null,
  options: { budget?: { activeLimitMs?: number; toolCallLimit?: number }; sessions?: string } = {},
): Harness {
  const intake = fetcher
    ? createIntakeRecorder({
        db: t.db,
        secrets: memorySecretStore({ jev: 'k' }),
        fetch: fetcher,
        baseUrl: 'https://typesafe.test',
      })
    : undefined;
  const worker = startWorker({
    db: t.db,
    providers: new Map<string, Provider>([
      ['claude', fakeAgent('claude', CLAUDE_MODELS, options.sessions)],
      ['codex', fakeAgent('codex', CODEX_MODELS, options.sessions)],
    ]),
    leaseSeconds: 30,
    concurrency: 8,
    pollMs: 20,
    cancelPollMs: 20,
    approvalPollMs: 20,
    budgetPollMs: 50,
    ...(intake ? { intake } : {}),
    ...(options.budget ? { budget: options.budget } : {}),
  });
  return {
    worker,
    async stop() {
      await worker.stop();
      await intake?.settled();
    },
  };
}

export async function gitRepo(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'spark-orchestration-')));
  await writeFile(join(root, 'notes.txt'), 'start\n');
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args]);
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
  return root;
}

export const removeRepo = (root: string) => rm(root, { recursive: true, force: true });

export async function startScenario(
  t: TestDb,
  root: string,
  scenario: Scenario,
  level: InvolvementLevel,
  routing: 'auto' | 'pinned' = 'auto',
) {
  const { conversationId } = await linkedConversation(t, root);
  await t.db.query('UPDATE conversations SET model_routing = $2 WHERE id = $1', [
    conversationId,
    routing,
  ]);
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: scenario.text },
    { provider: 'claude', model: 'sonnet', effort: 'medium', permission: scenario.mode, level },
  );
  return { conversationId, runId: sent.run.id };
}

export type Answerer = (approval: Approval) => { optionId: string; note?: string } | null;

export const answerEverything: Answerer = (approval) => {
  if (approval.kind === 'clarify') return { optionId: clarifyOptionId(0) };
  if (approval.kind === 'plan') return { optionId: CHECKPOINT_OPTION.approvePlan };
  if (approval.kind === 'retry') return { optionId: CHECKPOINT_OPTION.retry };
  if (approval.kind === 'accept') return { optionId: CHECKPOINT_OPTION.keep };
  if (approval.kind === 'budget') return { optionId: CHECKPOINT_OPTION.continueBudget };
  const allow = approval.options.find((option) => option.kind === 'allow_once');
  return allow ? { optionId: allow.optionId } : null;
};

export async function driveToEnd(
  t: TestDb,
  conversationId: string,
  runId: string,
  answer: Answerer = answerEverything,
  timeoutMs = 60_000,
): Promise<{ asked: Approval[]; orchestration: Orchestration }> {
  const asked: Approval[] = [];
  await eventually(async () => {
    const detail = await getConversationDetail(t.db, conversationId);
    for (const approval of detail?.approvals ?? []) {
      if (asked.some((seen) => seen.id === approval.id)) continue;
      const decision = answer(approval);
      if (!decision) continue;
      asked.push(approval);
      await decideApproval(t.db, t.workspaceId, approval.id, { scope: 'once', ...decision });
    }
    const run = await getRun(t.db, runId);
    return run?.finishedAt ? run : null;
  }, timeoutMs);
  const orchestration = await loadOrchestration(t.db, runId);
  if (!orchestration) throw new Error('No orchestration was recorded.');
  return { asked, orchestration };
}
