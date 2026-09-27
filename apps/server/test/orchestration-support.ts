import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHECKPOINT_OPTION,
  clarifyOptionId,
  type Approval,
  type ApprovalScope,
  type InvolvementLevel,
  type Orchestration,
} from '@spark-outpost/contracts';
import { createIntakeRecorder } from '../src/advisor/intake-recorder.ts';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { decideApproval } from '../src/persistence/approvals.ts';
import { getConversationDetail, sendUserMessage } from '../src/persistence/conversations.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { getRun } from '../src/persistence/runs.ts';
import type { OrchestratorDeps } from '../src/orchestration/session.ts';
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
  question?: number;
  destructive?: number;
  review?: number;
  vague?: number;
  continuesTask?: number;
  tier?: 'small' | 'mid' | 'top';
  tierConfidence?: number;
  intent?: string;
  intentConfidence?: number;
  intentProbabilities?: Record<string, number>;
}

export const SCENARIOS: readonly Scenario[] = [
  { id: 'question', text: 'What does parseDate do?', mode: 'ask', tier: 'small' },
  {
    id: 'trivial',
    text: 'Fix the typo in the README heading. #build',
    mode: 'do',
    question: 0.02,
    destructive: 0.03,
    tier: 'small',
  },
  {
    id: 'normal',
    text: 'The divider shows the wrong day after midnight. Fix it and add a test. #build',
    mode: 'do',
    question: 0.03,
    destructive: 0.05,
    tier: 'mid',
  },
  {
    id: 'complex',
    text: 'Move date handling into one module and update every component. #build',
    mode: 'do',
    question: 0.03,
    destructive: 0.2,
    tier: 'top',
  },
  {
    id: 'risky',
    text: 'Rename the runs table column and migrate old rows. #build',
    mode: 'do',
    question: 0.02,
    destructive: 0.93,
    tier: 'top',
  },
];

export const LEVELS: readonly InvolvementLevel[] = [
  'hands-on',
  'balanced',
  'hands-off',
  'full-auto',
];

type Answers = Record<string, unknown>;

function choice(value: string, confidence: number, second?: string): Answers[string] {
  const probabilities: Record<string, number> = { [value]: confidence };
  if (second) probabilities[second] = 1 - confidence;
  return { type: 'choice', choice: value, probabilities, confidence };
}

const noul = (value: number) => ({ type: 'noul', noul: value });

export interface JevScript {
  calls: { questions: string[]; state: Record<string, unknown> }[];
  scenario?: Scenario;
  policy?: Partial<Record<string, number>>;
  verify?: number;
  choices?: Partial<Record<string, string>>;
}

interface AskedQuestion {
  type?: string;
  criteria?: Record<string, unknown>;
}

function preferredOption(key: string, options: readonly string[], script: JevScript): string {
  const wanted = script.choices?.[key];
  if (wanted && options.includes(wanted)) return wanted;
  return options.find((option) => option !== 'uncertain') ?? options[0]!;
}

function spreadChoice(key: string, question: AskedQuestion, script: JevScript): Answers[string] {
  const options = Object.keys(question.criteria ?? {});
  const top = preferredOption(key, options, script);
  const rest = options.filter((option) => option !== top);
  const topMass = rest.length > 0 ? 0.8 : 1;
  const probabilities: Record<string, number> = { [top]: topMass };
  for (const option of rest) probabilities[option] = (1 - topMass) / rest.length;
  const n = options.length;
  const confidence = n > 1 ? (n * topMass - 1) / (n - 1) : 1;
  return { type: 'choice', choice: top, probabilities, confidence };
}

function intentAnswer(scenario: Scenario): Answers[string] {
  const intent = scenario.intent ?? (scenario.mode === 'ask' ? 'question' : 'bug_fix');
  const confidence = scenario.intentConfidence ?? 0.9;
  if (!scenario.intentProbabilities) return choice(intent, confidence);
  return {
    type: 'choice',
    choice: intent,
    probabilities: scenario.intentProbabilities,
    confidence,
  };
}

const NOUL_FIELDS = [
  ['question', 'question'],
  ['destructive', 'destructive'],
  ['review', 'review'],
  ['vague', 'vague'],
  ['continues_task', 'continuesTask'],
] as const;

function intakeAnswers(scenario: Scenario, questions: Record<string, unknown>): Answers {
  const answers: Answers = { intent: intentAnswer(scenario) };
  for (const [key, field] of NOUL_FIELDS) {
    const value = scenario[field];
    if (questions[key] && value !== undefined) answers[key] = noul(value);
  }
  if (questions.tier && scenario.tier) {
    answers.tier = choice(scenario.tier, scenario.tierConfidence ?? 0.95);
  }
  if (questions.injection) answers.injection = noul(0.05);
  return answers;
}

function observedAnswers(script: JevScript, questions: Record<string, AskedQuestion>): Answers {
  return Object.fromEntries(
    Object.entries(questions).map(([key, question]) => [
      key,
      question.type === 'choice'
        ? spreadChoice(key, question, script)
        : noul(script.policy?.[key] ?? (key.startsWith('unmet_') ? (script.verify ?? 0.05) : 0.05)),
    ]),
  );
}

export function jevFetch(script: JevScript): typeof fetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      state: Record<string, unknown>;
      questions: Record<string, AskedQuestion & { criteria?: Record<string, string> }>;
    };
    script.calls.push({ questions: Object.keys(body.questions), state: body.state });
    const task = String(body.state.task ?? '');
    const scenario =
      script.scenario ??
      SCENARIOS.find((candidate) => task.startsWith(candidate.text)) ??
      SCENARIOS[0]!;
    const answers = body.questions.intent
      ? intakeAnswers(scenario, body.questions)
      : observedAnswers(script, body.questions);
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
  options: {
    budget?: { activeLimitMs?: number; toolCallLimit?: number };
    sessions?: string;
    loopGuard?: OrchestratorDeps['loopGuard'];
    codeScan?: OrchestratorDeps['codeScan'];
  } = {},
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
    ...(options.loopGuard !== undefined ? { loopGuard: options.loopGuard } : {}),
    ...(options.codeScan ? { codeScan: options.codeScan } : {}),
  });
  return {
    worker,
    async stop() {
      await worker.stop();
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

export type Answerer = (
  approval: Approval,
) => { optionId: string; note?: string; scope?: ApprovalScope } | null;

export const answerEverything: Answerer = (approval) => {
  if (approval.kind === 'clarify') return { optionId: clarifyOptionId(0) };
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
  if (!orchestration) {
    const run = await getRun(t.db, runId);
    throw new Error(`No orchestration was recorded; the run ${run?.status}: ${run?.error}`);
  }
  return { asked, orchestration };
}
