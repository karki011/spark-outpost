import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHECKPOINT_OPTION,
  clarifyOptionId,
  modeForLegacy,
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
import { createProject } from '../src/projects/projects.ts';
import type { OrchestratorDeps } from '../src/orchestration/session.ts';
import type { Provider } from '../src/providers/provider.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { linkedConversation } from './approval-support.ts';
import { eventually, type TestDb } from './support.ts';
import { FAKE_ACP_LAUNCH } from './fake-acp-support.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';

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
export const EFFORTS = ['low', 'medium', 'high'].map((id) => ({
  id,
  label: id,
  description: null,
}));

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

const launch = FAKE_ACP_LAUNCH;

function sessionEnv(store: string | undefined): Record<string, string> {
  if (!store) return {};
  return {
    FAKE_ACP_SESSION_STORE: store,
    FAKE_ACP_SESSION_CAPABILITIES: JSON.stringify({ resume: {}, close: {} }),
  };
}

function fakeAgent(
  id: 'claude' | 'codex',
  models: typeof CLAUDE_MODELS,
  store?: string,
  extraEnv: Record<string, string> = {},
): Provider {
  return createAcpProvider({
    definition: { ...agentDefinitions[id], ...FAKE_AGENT_MODES },
    launch,
    cancelGraceMs: 2_000,
    env: {
      ...(process.env as Record<string, string>),
      ...extraEnv,
      FAKE_ACP_PROVIDER: id,
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
  planOnly?: number;
  destructive?: number;
  review?: number;
  vague?: number;
  continuesTask?: number;
  planAgreed?: number;
  tier?: 'small' | 'mid' | 'top';
  tierConfidence?: number;
  intent?: string;
  intentConfidence?: number;
  intentProbabilities?: Record<string, number>;
  speed?: Record<string, number>;
  ratings?: Partial<Record<'complexity' | 'ambiguity' | 'stakes' | 'context_dependence', number>>;
}

export const QUESTION: Scenario = {
  id: 'question',
  text: 'What does parseDate do?',
  mode: 'ask',
  tier: 'small',
};
export const TRIVIAL: Scenario = {
  id: 'trivial',
  text: 'Fix the typo in the README heading. #build',
  mode: 'do',
  question: 0.02,
  destructive: 0.03,
  tier: 'small',
};
export const NORMAL: Scenario = {
  id: 'normal',
  text: 'The divider shows the wrong day after midnight. Fix it and add a test. #build',
  mode: 'do',
  question: 0.03,
  destructive: 0.05,
  tier: 'mid',
};
export const COMPLEX: Scenario = {
  id: 'complex',
  text: 'Move date handling into one module and update every component. #build',
  mode: 'do',
  question: 0.03,
  destructive: 0.2,
  tier: 'top',
};
export const RISKY: Scenario = {
  id: 'risky',
  text: 'Rename the runs table column and migrate old rows. #build',
  mode: 'do',
  question: 0.02,
  destructive: 0.93,
  tier: 'top',
};

export const SCENARIOS: readonly Scenario[] = [QUESTION, TRIVIAL, NORMAL, COMPLEX, RISKY];

export function withTag(scenario: Scenario, tag: string): Scenario {
  return { ...scenario, text: `${scenario.text} ${tag}` };
}

export const LEVELS: readonly InvolvementLevel[] = ['balanced', 'hands-off', 'full-auto'];

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
  verdicts?: { choice: string; confidence: number }[];
  choices?: Partial<Record<string, string>>;
  scores?: Partial<Record<string, number>>;
  topMass?: number;
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
  const topMass = rest.length > 0 ? (script.topMass ?? 0.8) : 1;
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
  ['plan_only', 'planOnly'],
  ['destructive', 'destructive'],
  ['review', 'review'],
  ['vague', 'vague'],
  ['continues_task', 'continuesTask'],
  ['plan_agreed', 'planAgreed'],
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
  for (const [key, value] of Object.entries(scenario.ratings ?? {})) {
    if (questions[key]) answers[key] = { type: 'score', score: value - 1, confidence: 0.9 };
  }
  if (questions.speed && scenario.speed) {
    const [top] = Object.entries(scenario.speed).sort(([, a], [, b]) => b - a);
    answers.speed = {
      type: 'choice',
      choice: top![0],
      probabilities: scenario.speed,
      confidence: top![1],
    };
  }
  return answers;
}

function verdictAnswer(script: JevScript): Answers[string] {
  const next = script.verdicts?.shift() ?? { choice: 'supported', confidence: 0.95 };
  return choice(next.choice, next.confidence);
}

function observedAnswers(script: JevScript, questions: Record<string, AskedQuestion>): Answers {
  return Object.fromEntries(
    Object.entries(questions).map(([key, question]) => [
      key,
      key === 'verdict'
        ? verdictAnswer(script)
        : question.type === 'choice'
          ? spreadChoice(key, question, script)
          : question.type === 'score'
            ? { type: 'score', score: (script.scores?.[key] ?? 2) - 1, confidence: 0.9 }
            : noul(
                script.policy?.[key] ?? (key.startsWith('unmet_') ? (script.verify ?? 0.05) : 0.05),
              ),
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
      script.scenario ?? SCENARIOS.find((candidate) => task.startsWith(candidate.text)) ?? QUESTION;
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
    budget?: { activeLimitMs?: number; toolCallLimit?: number; costCapUsd?: number };
    sessions?: string;
    loopGuard?: OrchestratorDeps['loopGuard'];
    codeScan?: OrchestratorDeps['codeScan'];
    budgetPollMs?: number;
    cancelPollMs?: number;
    shipAccess?: OrchestratorDeps['shipAccess'];
    fixRound?: OrchestratorDeps['fixRound'];
    coordinator?: OrchestratorDeps['coordinator'];
    forcedPlacement?: OrchestratorDeps['forcedPlacement'];
    agentEnv?: Record<string, string>;
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
      ['claude', fakeAgent('claude', CLAUDE_MODELS, options.sessions, options.agentEnv)],
      ['codex', fakeAgent('codex', CODEX_MODELS, options.sessions, options.agentEnv)],
    ]),
    leaseSeconds: 30,
    concurrency: 8,
    pollMs: 20,
    cancelPollMs: options.cancelPollMs ?? 20,
    approvalPollMs: 20,
    budgetPollMs: options.budgetPollMs ?? 50,
    ...(intake ? { intake } : {}),
    ...(options.budget ? { budget: options.budget } : {}),
    ...(options.loopGuard !== undefined ? { loopGuard: options.loopGuard } : {}),
    ...(options.codeScan ? { codeScan: options.codeScan } : {}),
    ...(options.shipAccess ? { shipAccess: options.shipAccess } : {}),
    ...(options.fixRound ? { fixRound: options.fixRound } : {}),
    ...(options.coordinator ? { coordinator: options.coordinator } : {}),
    ...(options.forcedPlacement ? { forcedPlacement: options.forcedPlacement } : {}),
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
  model = 'sonnet',
  agentMode: string | null = modeForLegacy('claude', scenario.mode, level),
  prepare?: (conversationId: string) => Promise<void>,
) {
  const { conversationId } = await linkedConversation(t, root);
  await prepare?.(conversationId);
  await t.db.query('UPDATE conversations SET model_routing = $2 WHERE id = $1', [
    conversationId,
    routing,
  ]);
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: scenario.text },
    { provider: 'claude', model, effort: 'medium', permission: scenario.mode, agentMode, level },
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
      if (approval.status !== 'pending') continue;
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

export async function setCheckCommands(
  t: TestDb,
  root: string,
  commands: string[] | null,
): Promise<void> {
  const { project } = await createProject(t.db, t.workspaceId, root);
  await t.db.query('UPDATE projects SET check_commands = $2 WHERE id = $1', [project.id, commands]);
}

export async function artifactBodies<T>(t: TestDb, kind: string): Promise<T[]> {
  const { rows } = await t.db.query<{ body: T }>(
    'SELECT body FROM run_artifacts WHERE kind = $1 ORDER BY version',
    [kind],
  );
  return rows.map((row) => row.body);
}

export async function assistantReplies(t: TestDb, runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ content: string }>(
    `SELECT content FROM messages WHERE run_id = $1 AND role = 'assistant' ORDER BY created_at`,
    [runId],
  );
  return rows.map((row) => row.content);
}
