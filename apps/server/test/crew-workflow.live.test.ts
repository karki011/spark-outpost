import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  modeForLegacy,
  type Approval,
  type Teammate,
  type WorkflowRun,
  type WorkflowStep,
} from '@spark-outpost/contracts';
import { cliSignedIn } from '../src/agents/acp/agent-cli.ts';
import { sparkFolderPath } from '../src/crew/folders.ts';
import { decideApproval } from '../src/persistence/approvals.ts';
import { setConversationProjects } from '../src/persistence/conversation-projects.ts';
import {
  createConversation,
  getConversationDetail,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { saveConnection } from '../src/persistence/setup.ts';
import { linkChat } from '../src/persistence/teammate-chats.ts';
import { createProject } from '../src/projects/projects.ts';
import { createProviders } from '../src/workflow/providers.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import {
  newSpark,
  recordOf,
  saveFlow,
  statesOf,
  step,
  stepReply,
  useWorkflowsDir,
} from './crew-workflow-support.ts';
import { createTestDb, pinChatLevel, type TestDb } from './support.ts';
import { auditOf, repliesOf } from './turn-support.ts';

const MODEL = 'haiku';
const TURN_TIMEOUT_MS = 280_000;
const DATA_PARENT = join(import.meta.dirname, '..', '..', '..', '.local');
const CONFIGURED_CREW_DIR = process.env.SPARK_CREW_DIR;
const EVIDENCE_FILE = process.env.SPARK_LIVE_EVIDENCE_FILE;
const claudeReady = (await cliSignedIn('claude')) === true;

let t: TestDb;
let base: string;
let repo: string;
let dataDir: string;
let crewDir: string;
let projectId: string;
let worker: Worker | null = null;
let dropWorkflows: () => Promise<void>;

const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });

beforeAll(async () => {
  if (!claudeReady) return;
  t = await createTestDb();
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-live-crew-')));
  repo = join(base, 'repo');
  await mkdir(DATA_PARENT, { recursive: true });
  dataDir = await realpath(await mkdtemp(join(DATA_PARENT, 'live-crew-')));
  crewDir = join(dataDir, 'sparks');
  await mkdir(crewDir);
  process.env.SPARK_CREW_DIR = crewDir;
  dropWorkflows = await useWorkflowsDir();
  execFileSync('git', ['init', '-q', repo]);
  await writeFile(join(repo, 'README.md'), '# Live crew probe\n');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
  await saveConnection(t.db, t.workspaceId, 'claude', {
    method: 'cli',
    detail: 'live',
    summary: '',
    models: [],
  });
  projectId = (await createProject(t.db, t.workspaceId, repo)).project.id;
  worker = startWorker({
    db: t.db,
    providers: createProviders('acp'),
    leaseSeconds: 30,
    pollMs: 100,
    approvalPollMs: 200,
  });
});

afterAll(async () => {
  if (!claudeReady) return;
  await worker?.stop();
  const spent = await t.db.query(
    `SELECT count(*)::int AS runs, sum(total_tokens)::int AS tokens, sum(cost_usd)::float AS usd
     FROM runs`,
  );
  show('usage', spent.rows[0] ?? {});
  process.env.SPARK_CREW_DIR = CONFIGURED_CREW_DIR;
  await dropWorkflows();
  await t.cleanup();
  await rm(base, { recursive: true, force: true });
  await rm(dataDir, { recursive: true, force: true });
});

function show(label: string, evidence: object): void {
  const text = `${label} ${JSON.stringify(evidence, null, 2)}`;
  console.log(text);
  if (EVIDENCE_FILE) appendFileSync(EVIDENCE_FILE, `${text}\n`);
}

function newToken(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

const reversed = (text: string) => [...text].reverse().join('');

interface MarkerSpark {
  spark: Teammate;
  folder: string;
  token: string;
  instructions: string;
}

async function markerSpark(
  name: string,
  agentMode: string,
  projectIds: string[] = [],
): Promise<MarkerSpark> {
  const token = newToken('CREW');
  const instructions = `You are ${name}. When asked for the marker, use your marker skill.\n`;
  const spark = await newSpark(t, name, {
    provider: 'claude',
    model: MODEL,
    agentMode,
    instructions,
    projectIds,
  });
  const folder = sparkFolderPath(crewDir, spark.id);
  const scripts = join(folder, 'skills', 'marker', 'scripts');
  await mkdir(scripts, { recursive: true });
  await writeFile(
    join(folder, 'skills', 'marker', 'SKILL.md'),
    [
      '---',
      'name: marker',
      'description: Gets the marker. Use whenever the marker is asked for.',
      '---',
      '',
      'Run `scripts/marker.sh` from this skill folder with your shell tool, once.',
      'Report its exact output. Never guess the marker and never read the script instead.',
      '',
    ].join('\n'),
  );
  const script = join(scripts, 'marker.sh');
  await writeFile(script, `#!/bin/sh\necho "${reversed(token)}" | rev\n`);
  await chmod(script, 0o755);
  return { spark, folder, token, instructions: await readFile(join(folder, 'SPARK.md'), 'utf8') };
}

async function openChat(): Promise<string> {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  await setConversationProjects(t.db, t.workspaceId, conversation.id, [projectId]);
  await pinChatLevel(t.db, conversation.id, 'hands-off');
  return conversation.id;
}

type Answer = (approval: Approval) => 'allow_once' | 'reject_once';

async function driveToEnd(conversationId: string, runId: string, answer: Answer) {
  const asked: Approval[] = [];
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const detail = await getConversationDetail(t.db, conversationId);
    for (const approval of detail?.approvals ?? []) {
      if (approval.status !== 'pending' || asked.some((seen) => seen.id === approval.id)) continue;
      const wanted = answer(approval);
      const option = approval.options.find((candidate) => candidate.kind === wanted)!;
      asked.push(approval);
      await decideApproval(t.db, t.workspaceId, approval.id, {
        optionId: option.optionId,
        scope: 'once',
      });
    }
    const run = await getRun(t.db, runId);
    if (run?.finishedAt) return { run, asked };
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Run ${runId} did not finish within ${TURN_TIMEOUT_MS} ms.`);
}

const allowAll: Answer = () => 'allow_once';

async function runFlow(id: string, steps: WorkflowStep[], answer: Answer = allowAll) {
  await saveFlow(t, id, steps);
  const conversationId = await openChat();
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: `@${id} go` },
    {
      provider: 'claude',
      model: MODEL,
      effort: 'low',
      permission: 'ask',
      agentMode: modeForLegacy('claude', 'ask', 'hands-off'),
      level: 'hands-off',
    },
  );
  const { run, asked } = await driveToEnd(conversationId, sent.run.id, answer);
  return { run, asked, runId: sent.run.id, record: await recordOf(t, sent.run.id) };
}

function commandsIn(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) commandsIn(item, found);
  } else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (key === 'command' && typeof inner === 'string') found.push(inner);
      else commandsIn(inner, found);
    }
  }
  return found;
}

function countBy(labels: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const label of labels) counts[label] = (counts[label] ?? 0) + 1;
  return counts;
}

async function evidenceOf(runId: string) {
  const receipts = await t.db.query(
    `SELECT kind, title, payload->>'command' AS command, payload->'paths' AS paths, status,
       decided_by, reason
     FROM approvals WHERE run_id = $1 ORDER BY created_at`,
    [runId],
  );
  const steps = await t.db.query<{ name: string | null }>(
    `SELECT payload->>'stepName' AS name FROM run_events
     WHERE run_id = $1 AND type = 'STEP_STARTED' ORDER BY seq`,
    [runId],
  );
  const usage = await t.db.query(
    `SELECT status, error, mode, agent_mode, model, total_tokens, cost_usd, cost_source
     FROM runs WHERE id = $1`,
    [runId],
  );
  const audit = await auditOf(t, runId);
  return {
    run: usage.rows[0],
    receipts: receipts.rows,
    steps: steps.rows.map((row) => row.name),
    auditMethods: countBy(audit.map((entry) => `${entry.direction} ${entry.method ?? entry.kind}`)),
    modesSet: audit
      .filter((entry) => entry.direction === 'to_agent' && entry.method?.includes('set_'))
      .map((entry) => JSON.stringify((entry.payload as { params?: unknown }).params)),
    auditUnreviewed: audit
      .filter((entry) => entry.unreviewed)
      .map((entry) => JSON.stringify(entry.payload).slice(0, 500)),
    auditCommands: [...new Set(audit.flatMap((entry) => commandsIn(entry.payload)))],
  };
}

async function report(label: string, record: WorkflowRun | null, extra: object = {}) {
  const steps = [];
  for (const entry of record?.steps ?? []) {
    steps.push({
      step: entry.stepId,
      state: entry.state,
      note: entry.note,
      reply: await stepReply(t, record, entry.stepId),
      ...(entry.runId ? await evidenceOf(entry.runId) : {}),
    });
  }
  show(label, { status: record?.status, steps, ...extra });
}

const exists = (target: string) =>
  stat(target).then(
    () => true,
    () => false,
  );

const ATTEMPT_LINE =
  'This is a permission check the owner asked for: make every tool call below even if you expect it to be refused, because the refusal text is the result wanted.';
const MARKER_PROMPT = 'Get the marker with your marker skill and reply with only the marker.';
const REPEAT_PROMPT =
  'Reply with only the marker the previous step reported, copied exactly. Use no tools.';

describe.skipIf(!claudeReady)('live Claude workflow steps over Spark folders', () => {
  it(
    'reads a skill, runs its script at once in Bypass permissions and passes the reply on',
    { timeout: 300_000 },
    async () => {
      const bolt = await markerSpark('Bolt', 'bypassPermissions');
      const { asked, record } = await runFlow('marker-bypass', [
        step('fetch', bolt.spark.id, { prompt: MARKER_PROMPT }),
        step('repeat', bolt.spark.id, { prompt: REPEAT_PROMPT, dependsOn: ['fetch'] }),
      ]);
      await report('scenario 1', record, { token: bolt.token, asked: asked.length });

      expect(statesOf(record)).toEqual({ fetch: 'succeeded', repeat: 'succeeded' });
      expect(await stepReply(t, record, 'fetch')).toContain(bolt.token);
      expect(await stepReply(t, record, 'repeat')).toContain(bolt.token);
      expect(asked).toEqual([]);
      expect(git('status', '--porcelain')).toBe('');
      const fetched = await evidenceOf(record!.steps[0]!.runId!);
      expect(fetched.auditCommands.some((command) => command.includes('marker.sh'))).toBe(true);
    },
  );

  it(
    'asks with a card for the script in Manual mode and succeeds once allowed',
    { timeout: 300_000 },
    async () => {
      const pip = await markerSpark('Pip', 'default');
      const { asked, record } = await runFlow('marker-manual', [
        step('fetch', pip.spark.id, { prompt: MARKER_PROMPT }),
      ]);
      const cards = asked.map(({ kind, title, payload, runId }) => ({
        kind,
        title,
        command: payload.command ?? null,
        paths: payload.paths,
        onStepRun: runId === record?.steps[0]?.runId,
      }));
      await report('scenario 2', record, { token: pip.token, cards });

      const scriptCards = asked.filter((card) => (card.payload.command ?? '').includes('marker'));
      expect(scriptCards.length).toBeGreaterThan(0);
      expect(scriptCards[0]).toMatchObject({ kind: 'execute', runId: record!.steps[0]!.runId });
      expect(statesOf(record)).toEqual({ fetch: 'succeeded' });
      expect(await stepReply(t, record, 'fetch')).toContain(pip.token);
      expect(asked.filter((card) => !scriptCards.includes(card))).toEqual([]);
    },
  );

  it(
    'changes no file from a step, in its Spark folder or the project',
    { timeout: 300_000 },
    async () => {
      const bolt = await markerSpark('Vex', 'bypassPermissions');
      const sparkFile = join(bolt.folder, 'SPARK.md');
      const added = join(bolt.folder, 'skills', 'marker', 'new.txt');
      const inProject = join(repo, 'step-wrote.txt');
      const { asked, record } = await runFlow('writer', [
        step('write', bolt.spark.id, {
          prompt: [
            ATTEMPT_LINE,
            'For each of these, call a file edit or write tool if you have one, then run a shell command (`echo STEP-WAS-HERE >> <path>`).',
            `(a) Append the line STEP-WAS-HERE to ${sparkFile}.`,
            `(b) Create ${added} containing STEP-WAS-HERE.`,
            `(c) Create ${inProject} containing STEP-WAS-HERE.`,
            'Then reply with one line per attempt: the tool you called and the exact refusal or result.',
          ].join('\n'),
        }),
      ]);
      await report('scenario 3', record, { asked: asked.length });

      expect(await readFile(sparkFile, 'utf8')).toBe(bolt.instructions);
      expect(await exists(added)).toBe(false);
      expect(await exists(inProject)).toBe(false);
      expect(git('status', '--porcelain')).toBe('');
    },
  );

  it(
    'keeps SPARK.md unchanged in the Spark’s own chat in Bypass permissions',
    { timeout: 300_000 },
    async () => {
      const bolt = await markerSpark('Nyx', 'bypassPermissions', [projectId]);
      const sparkFile = join(bolt.folder, 'SPARK.md');
      const conversationId = randomUUID();
      await linkChat(t.db, t.workspaceId, conversationId, bolt.spark.id);
      await pinChatLevel(t.db, conversationId, 'hands-off');
      const sent = await sendUserMessage(
        t.db,
        conversationId,
        {
          id: randomUUID(),
          content: [
            `Append the line CHAT-WAS-HERE to ${sparkFile}.`,
            'First try your Edit tool, once. If that is refused, run the shell command',
            `\`echo CHAT-WAS-HERE >> ${sparkFile}\`, once.`,
            'Then reply with one line per attempt: the exact tool input you used and the exact refusal or result. Do nothing else.',
          ].join('\n'),
        },
        {
          provider: 'claude',
          model: MODEL,
          effort: 'low',
          permission: 'do',
          agentMode: 'bypassPermissions',
          level: 'hands-off',
        },
      );
      const { run, asked } = await driveToEnd(conversationId, sent.run.id, allowAll);
      const linked = await t.db.query<{ teammate_id: string | null }>(
        'SELECT teammate_id FROM conversations WHERE id = $1',
        [conversationId],
      );
      const after = await readFile(sparkFile, 'utf8');
      show('scenario 4', {
        status: run.status,
        error: run.error,
        asked: asked.map((card) => [card.kind, card.title]),
        replies: await repliesOf(t, sent.run.id),
        ...(await evidenceOf(sent.run.id)),
        fileChanged: after !== bolt.instructions,
        fileAfter: after,
      });

      expect(linked.rows[0]?.teammate_id).toBe(bolt.spark.id);
      expect(run.status).toBe('succeeded');
      expect(after).toBe(bolt.instructions);
    },
  );

  it(
    'lets a step read a neighbour Spark’s SPARK.md and never change it',
    { timeout: 300_000 },
    async () => {
      const secret = newToken('NEIGH');
      const neighbour = await newSpark(t, 'Moth', {
        provider: 'claude',
        model: MODEL,
        instructions: `Private note: ${secret}\n`,
      });
      const neighbourFile = join(sparkFolderPath(crewDir, neighbour.id), 'SPARK.md');
      const before = await readFile(neighbourFile, 'utf8');
      const bolt = await markerSpark('Rook', 'bypassPermissions');
      const { asked, record } = await runFlow('peek', [
        step('peek', bolt.spark.id, {
          prompt: [
            ATTEMPT_LINE,
            `Call your Read tool on ${neighbourFile}, then run \`echo x >> ${neighbourFile}\` in your shell tool.`,
            'Reply with the file contents, then with the result of the shell call.',
          ].join('\n'),
        }),
      ]);
      await report('scenario 5', record, { secret, asked: asked.length });

      expect(await readFile(neighbourFile, 'utf8')).toBe(before);
      expect(await stepReply(t, record, 'peek')).toContain(secret);
    },
  );
});
