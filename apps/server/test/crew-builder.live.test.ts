import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SPARK_ACTION_KIND,
  SPARK_ACTION_OPTION,
  modeForLegacy,
  type Approval,
} from '@spark-outpost/contracts';
import { cliSignedIn } from '../src/agents/acp/agent-cli.ts';
import { startBuilderChat } from '../src/crew-flows/builder-chat.ts';
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
import { replyText } from '../src/persistence/spark-mentions.ts';
import { createProject } from '../src/projects/projects.ts';
import { startSparkActionFollowThrough } from '../src/spark-mcp/actions/follow-through.ts';
import { startSparkMcpHost, type SparkMcpHost } from '../src/spark-mcp/host.ts';
import { createProviders } from '../src/workflow/providers.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import {
  recordOf,
  saveFlow,
  statesOf,
  step,
  stepReply,
  useWorkflowsDir,
} from './crew-workflow-support.ts';
import { toolDeps } from './spark-mcp-support.ts';
import { createTestDb, pinChatLevel, type TestDb } from './support.ts';
import { auditOf } from './turn-support.ts';

const BUILDER_MODEL = 'sonnet';
const STEP_MODEL = 'haiku';
const TURN_TIMEOUT_MS = 400_000;
const DATA_PARENT = join(import.meta.dirname, '..', '..', '..', '.local');
const CONFIGURED_CREW_DIR = process.env.SPARK_CREW_DIR;
const EVIDENCE_FILE = process.env.SPARK_LIVE_EVIDENCE_FILE;
const claudeReady = (await cliSignedIn('claude')) === true;

let t: TestDb;
let repo: string;
let dataDir: string;
let crewDir: string;
let projectId: string;
let host: SparkMcpHost | null = null;
let followThrough: { stop(): Promise<void> } | null = null;
let worker: Worker | null = null;
let dropWorkflows: () => Promise<void>;

beforeAll(async () => {
  if (!claudeReady) return;
  t = await createTestDb();
  repo = await realpath(await mkdtemp(join(tmpdir(), 'spark-live-builder-')));
  await mkdir(DATA_PARENT, { recursive: true });
  dataDir = await realpath(await mkdtemp(join(DATA_PARENT, 'live-builder-')));
  crewDir = join(dataDir, 'sparks');
  await mkdir(crewDir);
  process.env.SPARK_CREW_DIR = crewDir;
  dropWorkflows = await useWorkflowsDir();
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args]);
  git('init', '-q');
  await writeFile(join(repo, 'README.md'), '# Live builder probe\n');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
  await saveConnection(t.db, t.workspaceId, 'claude', {
    method: 'cli',
    detail: 'live',
    summary: '',
    models: [],
  });
  projectId = (await createProject(t.db, t.workspaceId, repo)).project.id;
  const chatFolders = join(dataDir, 'chats');
  const deps = toolDeps(t, { chatFolders, agentRuntime: 'acp' });
  host = await startSparkMcpHost(deps);
  followThrough = await startSparkActionFollowThrough(deps, 100);
  worker = startWorker({
    db: t.db,
    providers: createProviders('acp', undefined, undefined, host),
    chatFolders,
    leaseSeconds: 30,
    pollMs: 100,
    approvalPollMs: 200,
  });
});

afterAll(async () => {
  if (!claudeReady) return;
  await worker?.stop();
  await followThrough?.stop();
  await host?.close();
  const spent = await t.db.query(
    `SELECT count(*)::int AS runs, sum(total_tokens)::int AS tokens, sum(cost_usd)::float AS usd
     FROM runs`,
  );
  show('usage', spent.rows[0] ?? {});
  process.env.SPARK_CREW_DIR = CONFIGURED_CREW_DIR;
  await dropWorkflows();
  await t.cleanup();
  await rm(repo, { recursive: true, force: true });
  await rm(dataDir, { recursive: true, force: true });
});

function show(label: string, evidence: object): void {
  const text = `${label} ${JSON.stringify(evidence, null, 2)}`;
  console.log(text);
  if (EVIDENCE_FILE) appendFileSync(EVIDENCE_FILE, `${text}\n`);
}

const reversed = (text: string) => [...text].reverse().join('');
const token = `TALLY-${randomUUID().slice(0, 8).toUpperCase()}`;

const SKILL_MD = [
  '---',
  'name: marker',
  'description: Gets the marker. Use whenever the marker is asked for.',
  '---',
  '',
  'From this skill folder, run `sh scripts/marker.sh` with your shell tool, once.',
  'Report its exact output. Never guess the marker and never read the script or data instead.',
  '',
].join('\n');

const MARKER_SH = '#!/bin/sh\nrev "$(dirname "$0")/../data/token.txt"\n';
const TOKEN_TXT = `${reversed(token)}\n`;

const BUILDER_PROMPT = [
  'Create a new Spark named Tally, role "Marker fetcher", provider claude, model haiku,',
  'agent mode bypassPermissions, with SPARK.md: "You are Tally. When asked for the marker, use your marker skill."',
  'Then give Tally a skill with exactly these three files, contents exact, in one spark_crew_edit call:',
  '',
  'skills/marker/SKILL.md:',
  '```',
  SKILL_MD,
  '```',
  'skills/marker/scripts/marker.sh:',
  '```',
  MARKER_SH,
  '```',
  'skills/marker/data/token.txt:',
  '```',
  TOKEN_TXT,
  '```',
  'Wait for each card to be answered before the next step. Reply "built" when both are done.',
].join('\n');

const MARKER_PROMPT = 'Get the marker with your marker skill and reply with only the marker.';

type Target = Parameters<typeof sendUserMessage>[3];

const target = (model: string, agentMode: string): Target => ({
  provider: 'claude',
  model,
  effort: 'low',
  permission: 'do',
  agentMode,
  level: 'hands-off',
});

function allowOption(approval: Approval): string {
  const wanted = approval.kind === SPARK_ACTION_KIND ? SPARK_ACTION_OPTION.confirm : null;
  const option = wanted
    ? approval.options.find((candidate) => candidate.optionId === wanted)
    : approval.options.find((candidate) => candidate.kind === 'allow_once');
  if (!option) throw new Error(`No allow option on ${approval.kind} card ${approval.title}`);
  return option.optionId;
}

async function driveToEnd(conversationId: string, runId: string) {
  const asked: { kind: string; title: string; action: unknown }[] = [];
  const seen = new Set<string>();
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const detail = await getConversationDetail(t.db, conversationId);
    for (const approval of detail?.approvals ?? []) {
      if (approval.status !== 'pending' || seen.has(approval.id)) continue;
      seen.add(approval.id);
      const payload = approval.payload as { sparkAction?: { action?: string } };
      asked.push({
        kind: approval.kind,
        title: approval.title,
        action: payload.sparkAction?.action,
      });
      await decideApproval(t.db, t.workspaceId, approval.id, {
        optionId: allowOption(approval),
        scope: 'once',
      });
    }
    const run = await getRun(t.db, runId);
    if (run?.finishedAt) return { run, asked };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Run ${runId} did not finish within ${TURN_TIMEOUT_MS} ms.`);
}

async function sparkNamed(name: string) {
  const { rows } = await t.db.query<{
    id: string;
    provider: string | null;
    model: string | null;
    agent_mode: string | null;
  }>(
    'SELECT id, provider, model, agent_mode FROM teammates WHERE workspace_id = $1 AND name = $2',
    [t.workspaceId, name],
  );
  return rows[0] ?? null;
}

async function eventually<T>(read: () => Promise<T | null>, ms = 10_000): Promise<T | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const readOrNull = (file: string) => readFile(file, 'utf8').catch(() => null);
const modeOf = async (file: string) => ((await stat(file)).mode & 0o777).toString(8);

async function commandsOf(runId: string): Promise<string[]> {
  const found: string[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        if (key === 'command' && typeof inner === 'string') found.push(inner);
        else walk(inner);
      }
    }
  };
  for (const entry of await auditOf(t, runId)) walk(entry.payload);
  return [...new Set(found)];
}

const NEXT_PROMPT = 'I answered the card. Go on with the next step.';
const BUILDER_TURNS_MAX = 4;

async function skillWritten(): Promise<boolean> {
  const spark = await sparkNamed('Tally');
  if (!spark) return false;
  const skill = join(sparkFolderPath(crewDir, spark.id), 'skills', 'marker', 'SKILL.md');
  return (await readOrNull(skill)) !== null;
}

async function builderTurns(conversationId: string) {
  const turns = [];
  for (let index = 0; index < BUILDER_TURNS_MAX; index += 1) {
    const content = index === 0 ? BUILDER_PROMPT : NEXT_PROMPT;
    const sent = await sendUserMessage(
      t.db,
      conversationId,
      { id: randomUUID(), content },
      target(BUILDER_MODEL, 'bypassPermissions'),
    );
    const driven = await driveToEnd(conversationId, sent.run.id);
    turns.push({ sent: index === 0 ? 'build prompt' : NEXT_PROMPT, ...driven });
    if (await eventually(async () => ((await skillWritten()) ? true : null))) break;
  }
  return turns;
}

async function projectChat(): Promise<string> {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  await setConversationProjects(t.db, t.workspaceId, conversation.id, [projectId]);
  await pinChatLevel(t.db, conversation.id, 'hands-off');
  return conversation.id;
}

describe.skipIf(!claudeReady)('live Claude builder chat makes a Spark that a chat can call', () => {
  let sparkId = '';
  let folder = '';

  it(
    'creates the Spark and its skill files at the paths asked, after the cards are allowed',
    { timeout: TURN_TIMEOUT_MS + 60_000 },
    async () => {
      const builder = await startBuilderChat(
        { db: t.db, workspaceId: t.workspaceId },
        randomUUID(),
      );
      const turns = await builderTurns(builder.conversationId);
      const run = turns.at(-1)!.run;
      const asked = turns.flatMap((turn) => turn.asked);
      const spark = await sparkNamed('Tally');
      folder = spark ? sparkFolderPath(crewDir, spark.id) : '';
      const skill = join(folder, 'skills', 'marker');
      const files = {
        skill: await eventually(() => readOrNull(join(skill, 'SKILL.md'))),
        script: await readOrNull(join(skill, 'scripts', 'marker.sh')),
        data: await readOrNull(join(skill, 'data', 'token.txt')),
      };
      show('builder', {
        status: run.status,
        error: run.error,
        asked,
        turns: await Promise.all(
          turns.map(async (turn) => ({
            sent: turn.sent,
            reply: await replyText(t.db, turn.run.id),
          })),
        ),
        spark,
        folder,
        files,
        scriptMode: files.script ? await modeOf(join(skill, 'scripts', 'marker.sh')) : null,
      });

      expect(run.status).toBe('succeeded');
      expect(asked.map((card) => card.action)).toEqual(
        expect.arrayContaining(['create_teammate', 'crew_edit']),
      );
      expect(spark).not.toBeNull();
      expect(files.skill?.trim()).toBe(SKILL_MD.trim());
      expect(files.script?.trim()).toBe(MARKER_SH.trim());
      expect(files.data?.trim()).toBe(TOKEN_TXT.trim());
      sparkId = spark!.id;
    },
  );

  it(
    'runs the skill script by its path when a chat calls the Spark through a workflow',
    { timeout: TURN_TIMEOUT_MS + 60_000 },
    async () => {
      expect(sparkId).not.toBe('');
      await t.db.query(
        `UPDATE teammates SET provider = 'claude', model = $2, agent_mode = 'bypassPermissions'
         WHERE id = $1`,
        [sparkId, STEP_MODEL],
      );
      await saveFlow(t, 'tally-marker', [step('fetch', sparkId, { prompt: MARKER_PROMPT })]);
      const chat = await projectChat();
      const sent = await sendUserMessage(
        t.db,
        chat,
        { id: randomUUID(), content: '@tally-marker go' },
        {
          ...target(STEP_MODEL, modeForLegacy('claude', 'ask', 'hands-off') ?? 'default'),
          permission: 'ask',
        },
      );
      const { asked } = await driveToEnd(chat, sent.run.id);
      const record = await recordOf(t, sent.run.id);
      const stepRun = record?.steps[0]?.runId ?? null;
      const commands = stepRun ? await commandsOf(stepRun) : [];
      const reply = await stepReply(t, record, 'fetch');
      show('workflow', { states: statesOf(record), asked, reply, commands });

      expect(statesOf(record)).toEqual({ fetch: 'succeeded' });
      expect(reply).toContain(token);
      expect(commands.some((command) => command.includes('scripts/marker.sh'))).toBe(true);
    },
  );

  it(
    'hands an @Spark job to a read-only subagent, which cannot run the script',
    { timeout: TURN_TIMEOUT_MS + 60_000 },
    async () => {
      expect(sparkId).not.toBe('');
      const chat = await projectChat();
      const sent = await sendUserMessage(
        t.db,
        chat,
        { id: randomUUID(), content: `@Tally ${MARKER_PROMPT}` },
        target(STEP_MODEL, 'bypassPermissions'),
      );
      const { asked } = await driveToEnd(chat, sent.run.id);
      const { rows } = await t.db.query<{ id: string; mode: string; status: string }>(
        `SELECT id, mode, status FROM runs WHERE parent_run_id = $1 AND role = 'spark'`,
        [sent.run.id],
      );
      const child = rows[0];
      const commands = child ? await commandsOf(child.id) : [];
      show('handoff', {
        child,
        asked,
        childReply: child ? await replyText(t.db, child.id) : null,
        chatReply: await replyText(t.db, sent.run.id),
        commands,
        folder,
      });

      expect(child).toMatchObject({ mode: 'ask' });
      expect(await replyText(t.db, child!.id)).not.toContain(token);
    },
  );
});
