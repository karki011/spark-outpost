import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertDecision } from '../src/persistence/orchestrations.ts';
import { insertPieceList } from '../src/persistence/pieces.ts';
import { seedConversation, seedIntake, seedTask, seedTurn } from './outcome-seed.ts';
import { startSparkTools, type SparkToolsHarness } from './spark-mcp-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

const LEAKED = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const CODEX = { provider: 'codex', model: 'gpt-5', modelLabel: 'GPT-5', effort: null };
const CLAUDE = { provider: 'claude', model: 'opus', modelLabel: 'Opus', effort: null };

let t: TestDb;
let tools: SparkToolsHarness | null = null;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await tools?.close();
  tools = null;
  await t.cleanup();
});

async function open(conversationId: string | null = null) {
  tools = await startSparkTools(t, { conversationId });
  return tools;
}

async function otherWorkspaceChat(): Promise<{ conversationId: string; runId: string }> {
  const workspaceId = randomUUID();
  await t.db.query(`INSERT INTO workspaces (id, slug, name) VALUES ($1, $2, 'Other')`, [
    workspaceId,
    `other-${workspaceId}`,
  ]);
  const conversationId = await seedConversation(t.db, workspaceId);
  return { conversationId, runId: await seedTurn(t.db, conversationId) };
}

async function pendingCard(runId: string, title: string, command: string | null = null) {
  await t.db.query(
    `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options,
       status, created_at)
     VALUES ($1, $2, $3, 'execute', $4, $5, 'h', $6, 'pending', now() - interval '5 minutes')`,
    [
      randomUUID(),
      runId,
      randomUUID(),
      title,
      JSON.stringify(command ? { command } : {}),
      JSON.stringify([
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
      ]),
    ],
  );
}

describe('spark_attention', () => {
  it('lists waiting cards and failed chats in this workspace only', async () => {
    const waiting = await startChat(t, 'Run the tests');
    await pendingCard(waiting.runId, 'Run npm test', 'npm test');
    const archived = await startChat(t, 'Old');
    await pendingCard(archived.runId, 'Run old thing');
    await t.db.query('UPDATE conversations SET archived_at = now() WHERE id = $1', [
      archived.conversationId,
    ]);
    const broken = await startChat(t, 'Broken');
    await t.db.query(`UPDATE runs SET status = 'failed', error = 'Agent crashed' WHERE id = $1`, [
      broken.runId,
    ]);
    const elsewhere = await otherWorkspaceChat();
    await pendingCard(elsewhere.runId, 'Run elsewhere');

    const body = (await (await open()).call('spark_attention')).json<{
      needsYou: boolean;
      pendingCards: Record<string, unknown>[];
      failedChats: { id: string; error: string }[];
    }>();

    expect(body.needsYou).toBe(true);
    expect(body.pendingCards).toEqual([
      expect.objectContaining({
        chat: { id: waiting.conversationId, title: expect.any(String) },
        kind: 'execute',
        asks: 'Run npm test',
        command: 'npm test',
        choices: ['Allow', 'Deny'],
        waitingMinutes: 5,
      }),
    ]);
    expect(body.failedChats).toEqual([
      expect.objectContaining({ id: broken.conversationId, error: 'Agent crashed' }),
    ]);
  });

  it('says nobody needs anything when nothing waits', async () => {
    await startChat(t, 'Quiet');
    const body = (await (await open()).call('spark_attention')).json<{ needsYou: boolean }>();
    expect(body.needsYou).toBe(false);
  });
});

async function seedCrew() {
  const conversationId = await seedConversation(t.db, t.workspaceId);
  const taskId = await seedTask(t.db, conversationId);
  const runId = await seedTurn(t.db, conversationId, { taskId, status: 'running' });
  await t.db.query(`UPDATE orchestrations SET phase = 'building' WHERE run_id = $1`, [runId]);
  await seedIntake(t.db, runId);
  const builderId = randomUUID();
  await t.db.query(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, model, status, task_id,
       parent_run_id, role, step_index, attempt, route, cost_usd)
     SELECT $1, $2, p.user_message_id, 'codex', 'gpt-5', 'running', $3, p.id, 'builder', 1, 1, $5,
       0.12
     FROM runs p WHERE p.id = $4`,
    [
      builderId,
      conversationId,
      taskId,
      runId,
      JSON.stringify({
        name: 'Bolt',
        routedBy: 'jev',
        pieceKey: 'P1',
        routeNote: 'Jev: a small UI piece fits GPT-5',
      }),
    ],
  );
  await insertPieceList(t.db, {
    taskId,
    orchestrationRunId: runId,
    planDocumentId: null,
    planVersion: null,
    piecesHash: 'hash',
    placement: 'shared',
    placementReason: 'Pieces touch different files.',
    integration: null,
    approvedBy: 'level',
    pieces: [
      {
        key: 'P1',
        title: 'Restyle the button',
        goal: 'New button style',
        owns: ['web/Button.tsx'],
        reads: [],
        dependsOn: [],
        contract: null,
        acceptance: [],
        checks: [],
        research: false,
        sizeEstimate: 1,
        placement: 'shared',
        provider: 'codex',
        model: 'gpt-5',
        pickNote: 'Jev: a small UI piece fits GPT-5',
      },
    ],
  });
  await insertDecision(t.db, {
    runId,
    purpose: 'piece_route',
    childRunId: null,
    role: 'builder',
    stepIndex: null,
    jevStatus: 'answered',
    inputTokens: 100,
    costUsd: 0.001,
    body: {
      summary: `Jev routed 1 piece ${LEAKED}`,
      applied: 'jev',
      gate: null,
      jevError: null,
      latencyMs: 40,
      answer: {
        pieces: [
          {
            key: 'P1',
            pick: CODEX,
            jevPick: CODEX,
            rulesPick: CLAUDE,
            decidedBy: 'jev',
            reason: 'small UI change',
          },
        ],
      },
    },
  });
  await insertDecision(t.db, {
    runId,
    purpose: 'clarify',
    childRunId: null,
    role: 'scout',
    stepIndex: null,
    jevStatus: 'not_asked',
    inputTokens: null,
    costUsd: null,
    body: { round: 1, questions: ['Which page?', 'Dark mode too?'], answered: true, reply: 'text' },
  });
  return { conversationId, taskId, runId, builderId };
}

describe('spark_run', () => {
  it("shows the crew, each piece's Jev pick and every Jev decision, redacted", async () => {
    const { conversationId, builderId } = await seedCrew();
    const harness = await open(conversationId);

    const result = await harness.call('spark_run');
    const byChild = (await harness.call('spark_run', { run: builderId })).json<{
      run: { id: string };
    }>();

    expect(result.text).not.toContain(LEAKED);
    const body = result.json<{
      run: { id: string; status: string };
      crew: {
        phase: string;
        crew: Record<string, unknown>[];
        pieces: { items: Record<string, unknown>[] };
      };
      jevDecisions: Record<string, unknown>[];
    }>();
    expect(byChild.run.id).toBe(body.run.id);
    expect(body.run.status).toBe('running');
    expect(body.crew.phase).toBe('building');
    expect(body.crew.crew).toEqual([
      expect.objectContaining({
        name: 'Bolt',
        role: 'builder',
        piece: 'P1',
        agent: 'codex · gpt-5',
        pickedBy: 'jev',
        why: 'Jev: a small UI piece fits GPT-5',
      }),
    ]);
    expect(body.crew.pieces.items).toEqual([
      expect.objectContaining({
        key: 'P1',
        status: 'pending',
        jevPick: 'Jev: a small UI piece fits GPT-5',
        owns: ['web/Button.tsx'],
      }),
    ]);
    expect(body.jevDecisions.map((decision) => decision.kind)).toEqual([
      'intake',
      'piece_route',
      'clarify',
    ]);
    expect(body.jevDecisions[1]).toMatchObject({
      jev: 'answered',
      applied: 'jev',
      picks: [
        {
          piece: 'P1',
          pick: 'codex · GPT-5',
          decidedBy: 'jev',
          reason: 'small UI change',
          jevPick: 'codex · GPT-5',
          rulesPick: 'claude · Opus',
        },
      ],
    });
    expect(body.jevDecisions[2]).toMatchObject({ questions: 2, answered: true });
  });

  it("refuses another workspace's run and a chat with no runs", async () => {
    const elsewhere = await otherWorkspaceChat();
    const empty = await seedConversation(t.db, t.workspaceId);
    const harness = await open();

    const foreign = await harness.call('spark_run', { run: elsewhere.runId });
    const foreignChat = await harness.call('spark_run', { chat: elsewhere.conversationId });
    const none = await harness.call('spark_run', { chat: empty });

    expect(foreign).toMatchObject({ isError: true, text: 'That run does not exist.' });
    expect(foreignChat.isError).toBe(true);
    expect(none.text).toContain('has no runs yet');
  });
});

describe('spark_task', () => {
  let root: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'spark-task-')));
    await writeFile(join(root, 'a.ts'), 'export const a = 1;\n');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('add', '.');
    git('-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-qm', 'init');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns the current plan and changed files with line counts but never contents', async () => {
    const ref = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
    const conversationId = await seedConversation(t.db, t.workspaceId);
    const taskId = await seedTask(t.db, conversationId);
    const runId = await seedTurn(t.db, conversationId, { taskId, snapshot: { ref, root } });
    const plan = (version: number, status: string) => ({
      entries: [
        { content: `Step one v${version}`, priority: 'high', status },
        { content: 'Step two', priority: 'medium', status: 'pending' },
      ],
    });
    for (const version of [1, 2]) {
      await t.db.query(
        `INSERT INTO run_artifacts (task_id, kind, version, body, source_run_id)
         VALUES ($1, 'plan', $2, $3, $4)`,
        [taskId, version, JSON.stringify(plan(version, 'completed')), runId],
      );
    }
    await writeFile(join(root, 'a.ts'), `export const a = 1;\nexport const key = '${LEAKED}';\n`);
    await writeFile(join(root, 'b.ts'), 'export const b = 2;\n');

    const result = await (await open(conversationId)).call('spark_task');

    expect(result.text).not.toContain(LEAKED);
    expect(result.text).not.toContain('export const');
    const body = result.json<{
      task: { id: string };
      plan: { version: number; of: number; steps: object[] };
      filesChanged: { files: number; added: number; byRun: { files: object[] }[] };
    }>();
    expect(body.task.id).toBe(taskId);
    expect(body.plan).toEqual({
      version: 2,
      of: 2,
      steps: [
        { step: 'Step one v2', status: 'completed' },
        { step: 'Step two', status: 'pending' },
      ],
    });
    expect(body.filesChanged).toMatchObject({ files: 2, added: 2 });
    expect(body.filesChanged.byRun[0]!.files).toEqual(
      expect.arrayContaining([
        { path: 'a.ts', change: 'modified', added: 1, removed: 0 },
        { path: 'b.ts', change: 'added', added: 1, removed: 0 },
      ]),
    );
  });

  it('says when a chat has no task', async () => {
    const chat = await startChat(t, 'Just a question');
    const result = await (await open(chat.conversationId)).call('spark_task');
    expect(result).toMatchObject({ isError: true });
    expect(result.text).toContain('no task yet');
  });
});
