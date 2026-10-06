import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stopParseWorker } from '../src/codescan/parse-pool.ts';
import type { Observation } from '../src/persistence/observations.ts';
import { forgetAllShells, listShells, recordShell } from '../src/persistence/terminal-shells.ts';
import type { RunObservations } from '../src/observations/run-observations.ts';
import { shellRegistry } from '../src/terminal/shell-registry.ts';
import { addProject, fakeJev, mapBuilder, writeRepo } from './map-support.ts';
import { seedConversation, seedTurn } from './outcome-seed.ts';
import { startSparkTools, type SparkToolsHarness } from './spark-mcp-support.ts';
import { createTestDb, eventually, startChat, type TestDb } from './support.ts';

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

afterAll(async () => {
  await stopParseWorker();
});

async function open(conversationId: string | null = null) {
  tools = await startSparkTools(t, { conversationId });
  return tools;
}

async function chatWithCost(title: string, provider: string, model: string, cost: number) {
  const chat = await startChat(t, title);
  await t.db.query(
    `UPDATE runs SET provider = $2, model = $3, cost_usd = $4, cost_source = 'reported',
       input_tokens = 1000, output_tokens = 500 WHERE id = $1`,
    [chat.runId, provider, model, cost],
  );
  return chat;
}

describe('spark_spend', () => {
  it("splits today's spend by provider, model and chat, most expensive first", async () => {
    const big = await chatWithCost('Big refactor', 'claude', 'opus', 1.5);
    const small = await chatWithCost('Small fix', 'codex', 'gpt-5', 0.25);
    const old = await chatWithCost('Last month', 'claude', 'opus', 9);
    await t.db.query(`UPDATE runs SET created_at = now() - interval '40 days' WHERE id = $1`, [
      old.runId,
    ]);
    await t.db.query(
      `INSERT INTO run_advice (run_id, purpose, jev_status, jev_input_tokens, jev_cost_usd, body)
       VALUES ($1, 'intake', 'answered', 200, 0.01, '{}')`,
      [big.runId],
    );

    const body = (await (await open()).call('spark_spend')).json<{
      range: string;
      costUsd: number;
      byProvider: { provider: string; costUsd: number }[];
      byModel: { name: string; costUsd: number }[];
      byChat: { id: string; title: string; costUsd: number }[];
    }>();

    expect(body.range).toBe('today');
    expect(body.costUsd).toBeCloseTo(1.76);
    expect(body.byProvider.map((row) => row.provider)).toEqual(['claude', 'codex', 'jev']);
    expect(body.byModel).toEqual([
      expect.objectContaining({ name: 'claude · opus', costUsd: 1.5 }),
      expect.objectContaining({ name: 'codex · gpt-5', costUsd: 0.25 }),
    ]);
    expect(body.byChat.map((row) => row.id)).toEqual([big.conversationId, small.conversationId]);
  });
});

describe('spark_models', () => {
  it('returns model cards for one provider and refuses a model nobody has', async () => {
    const harness = await open();

    const claude = (await harness.call('spark_models', { provider: 'claude' })).json<{
      providers: { id: string; models: { tier: string; pricePerMillion: object | null }[] }[];
    }>();
    const missing = await harness.call('spark_models', { model: 'no-such-model' });

    expect(claude.providers.map((entry) => entry.id)).toEqual(['claude']);
    expect(claude.providers[0]!.models.length).toBeGreaterThan(0);
    expect(claude.providers[0]!.models[0]).toMatchObject({ tier: expect.any(String) });
    expect(missing).toMatchObject({ isError: true, text: 'No model card matches that.' });
  });
});

describe('spark_analytics outcomes', () => {
  it('groups turn outcomes and feedback by provider', async () => {
    const conversationId = await seedConversation(t.db, t.workspaceId);
    for (const [verdict, rating] of [
      ['good', 'up'],
      ['bad', 'down'],
      ['good', null],
    ] as const) {
      const runId = await seedTurn(t.db, conversationId);
      await t.db.query(
        `INSERT INTO task_outcomes (run_id, verdict, rating, rated_at, comment)
         VALUES ($1, $2, $3, CASE WHEN $3::text IS NULL THEN NULL ELSE now() END, $4)`,
        [runId, verdict, rating, 'private words'],
      );
    }

    const result = await (
      await open()
    ).call('spark_analytics', { report: 'outcomes', days: 30, groupBy: 'provider' });

    expect(result.text).not.toContain('private words');
    expect(result.json()).toMatchObject({
      groupBy: 'provider',
      groups: [{ key: 'claude', turns: 3, good: 2, bad: 1, thumbsUp: 1, thumbsDown: 1 }],
    });
  });
});

describe('spark_terminals', () => {
  let busy: ChildProcess | null = null;

  afterEach(() => {
    busy?.kill();
    busy = null;
  });

  it('lists live shells in this workspace with whether a program runs, never output', async () => {
    const chat = await startChat(t, 'Shell chat');
    busy = spawn('/bin/sh', ['-c', 'sleep 30; true'], { stdio: 'ignore' });
    const busyPid = busy.pid!;
    await recordShell(t.db, t.workspaceId, {
      id: randomUUID(),
      conversationId: chat.conversationId,
      label: 'app',
      cwd: `${homedir()}/code/app`,
      pid: busyPid,
    });
    await recordShell(t.db, t.workspaceId, {
      id: randomUUID(),
      conversationId: null,
      label: '~',
      cwd: homedir(),
      pid: 2_147_000_000,
    });
    const otherWorkspace = randomUUID();
    await t.db.query(`INSERT INTO workspaces (id, slug, name) VALUES ($1, $2, 'Other')`, [
      otherWorkspace,
      `other-${otherWorkspace}`,
    ]);
    await recordShell(t.db, otherWorkspace, {
      id: randomUUID(),
      conversationId: null,
      label: 'theirs',
      cwd: '/tmp',
      pid: process.pid,
    });
    const harness = await open();

    const body = await eventually(async () => {
      const read = (await harness.call('spark_terminals')).json<{
        open: number;
        terminals: Record<string, unknown>[];
      }>();
      return read.terminals[0]?.busy ? read : null;
    });

    expect(body!.open).toBe(1);
    expect(body!.terminals).toEqual([
      {
        name: 'app',
        cwd: '~/code/app',
        chat: { id: chat.conversationId, title: expect.any(String) },
        openedAt: expect.any(String),
        busy: true,
        running: 'sleep',
      },
    ]);
  });

  it('keeps the table in step with the terminals the API opens and closes', async () => {
    const registry = shellRegistry(t.db, t.workspaceId);
    const shell = { id: randomUUID(), conversationId: null, label: '~', cwd: '/tmp', pid: 1 };
    registry.opened(shell);
    registry.ended(shell.id);
    registry.opened({ ...shell, id: randomUUID() });
    await eventually(async () => ((await listShells(t.db, t.workspaceId)).length === 1 ? 1 : null));
    expect((await listShells(t.db, t.workspaceId)).map((row) => row.id)).not.toContain(shell.id);

    await forgetAllShells(t.db, t.workspaceId);
    expect(await listShells(t.db, t.workspaceId)).toEqual([]);
  });
});

describe('spark_map with a file', () => {
  let root: string;

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns a file's neighbors and what breaks if it changes", async () => {
    root = await writeRepo({
      'package.json': '{ "name": "shop" }',
      'server/app.ts': "import { orders } from './orders';\nexport const app = orders;\n",
      'server/orders.ts': "import { db } from './db';\nexport const orders = db;\n",
      'server/db.ts': 'export const db = 1;\n',
    });
    await addProject(t, root, 'shop');
    const { builder, scanner } = mapBuilder(t, fakeJev().fetch);
    expect(await builder.runOnce()).toBe(true);
    await scanner.idle();
    const harness = await open();

    const body = (
      await harness.call('spark_map', { project: 'shop', file: './server/db.ts', hops: 2 })
    ).json<{
      file: string;
      imports: object[];
      importedBy: { path: string; hop: number; area: string }[];
      whatBreaks: { filesUsingItDirectly: number; filesDependingOnItInAll: number };
    }>();
    const missing = await harness.call('spark_map', { project: 'shop', file: 'nope.ts' });

    expect(body.file).toBe('server/db.ts');
    expect(body.imports).toEqual([]);
    expect(body.importedBy.map((file) => [file.path, file.hop])).toEqual([
      ['server/orders.ts', 1],
      ['server/app.ts', 2],
    ]);
    expect(body.importedBy[0]!.area).toEqual(expect.any(String));
    expect(body.whatBreaks).toMatchObject({ filesUsingItDirectly: 1, filesDependingOnItInAll: 2 });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('is not on shop');
  }, 30_000);
});

describe('marking Spark tool results as private work data', () => {
  it('records private data for the new chat and work tools but not for model cards', async () => {
    const chat = await startChat(t, 'Taint');
    const recorded: Observation[] = [];
    const observations: RunObservations = {
      record: (observation) => void recorded.push(observation),
      labels: async () => recorded.map((observation) => observation.label),
      egressAsked: () => undefined,
      settled: async () => undefined,
    };
    tools = await startSparkTools(t, {
      conversationId: chat.conversationId,
      runId: chat.runId,
      observations,
    });

    for (const name of ['spark_attention', 'spark_run', 'spark_spend', 'spark_terminals']) {
      expect((await tools.call(name)).isError).toBe(false);
    }
    expect((await tools.call('spark_models')).isError).toBe(false);

    expect(recorded.map((observation) => observation.label)).toEqual([
      'private work data (spark_attention)',
      'private work data (spark_spend)',
      'private work data (spark_terminals)',
    ]);
    expect(recorded.every((observation) => observation.source === 'private_data')).toBe(true);
  });
});
