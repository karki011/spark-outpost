import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  COMMAND_FINISHED,
  COMMAND_OUTPUT,
  COMMAND_STARTED,
  COMMAND_STORED_CHARS,
  type CommandRun,
} from '@spark-outpost/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { insertCommand, saveCommandOutput } from '../src/persistence/run-commands.ts';
import { createTestApp, localClient } from './app-support.ts';
import { FAKE_HUGE_LINES, FAKE_TERMINAL_SECRET } from './fake-acp-terminal.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { createTestDb, type TestDb } from './support.ts';
import { driveToEnd, gitRepo, openChat, removeRepo, sendMessage } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

const BUILD = 'Fix the typo in the README heading. #build';

const ESC = '\u001b';
const ENV_SECRET = 'demo9f3k2m7x1q8z5w4c6v0b';

let t: TestDb;
let root: string;
let store: string;
let worker: Worker | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
  await connectAgents(t);
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
  await removeRepo(root);
  rmSync(store, { recursive: true, force: true });
});

async function bypassRun(tags: string) {
  worker = startTurnWorker(t, { sessions: store });
  const conversationId = await openChat(t, { root, level: 'hands-off' });
  const runId = await sendMessage(t, conversationId, `${BUILD} ${tags}`, {
    permission: 'do',
    agentMode: 'bypassPermissions',
  });
  await driveToEnd(t, conversationId, runId);
  await worker.stop();
  worker = null;
  return { conversationId, runId };
}

interface CommandEventRow {
  seq: number;
  name: string;
  value: Record<string, unknown>;
}

async function commandEvents(conversationId: string): Promise<CommandEventRow[]> {
  const { rows } = await t.db.query<CommandEventRow>(
    `SELECT e.seq, e.payload->>'name' AS name, e.payload->'value' AS value
     FROM run_events e JOIN runs r ON r.id = e.run_id
     WHERE r.conversation_id = $1 AND e.type = 'CUSTOM' AND e.payload->>'name' LIKE 'command_%'
     ORDER BY e.run_id, e.seq`,
    [conversationId],
  );
  return rows;
}

async function storedOutput(id: string): Promise<string> {
  const { rows } = await t.db.query<{ output: string }>(
    'SELECT output FROM run_commands WHERE id = $1',
    [id],
  );
  return rows[0]!.output;
}

async function commandsOf(conversationId: string): Promise<CommandRun[]> {
  return (await getConversationDetail(t.db, conversationId))!.commands ?? [];
}

const named = (commands: CommandRun[], command: string) =>
  commands.find((candidate) => candidate.command === command)!;

describe('command output from an ACP agent', { timeout: 120_000 }, () => {
  it('stores streamed and end-only commands with status, exit code and place in the turn', async () => {
    const { conversationId } = await bypassRun('#term=pass,fail,endpass,endfail 5ms');
    const commands = await commandsOf(conversationId);
    expect(commands.map((command) => [command.command, command.status, command.exitCode])).toEqual([
      ['pnpm test', 'completed', 0],
      ['pnpm lint', 'failed', 2],
      ['pnpm test', 'completed', null],
      ['pnpm lint', 'failed', 2],
    ]);
    expect(commands.every((command) => command.cwd === './' && command.finishedAt)).toBe(true);
    expect(await storedOutput(commands[0]!.id)).toBe(
      `RUN v5\n${ESC}[32m✓${ESC}[0m one.test.ts\nTests 1 passed\n`,
    );
    expect(await storedOutput(commands[3]!.id)).toBe(
      `checking\n${ESC}[31merror${ESC}[0m unused variable`,
    );

    const events = await commandEvents(conversationId);
    const first = events.filter((event) => event.value.id === commands[0]!.id);
    expect(first.map((event) => event.name)).toEqual([
      COMMAND_STARTED,
      ...first.slice(1, -1).map(() => COMMAND_OUTPUT),
      COMMAND_FINISHED,
    ]);
    const chunks = first.filter((event) => event.name === COMMAND_OUTPUT);
    let position = 0;
    for (const chunk of chunks) {
      expect(chunk.value.at).toBe(position);
      position += String(chunk.value.chunk).length;
    }
    expect(position).toBe(commands[0]!.outputChars);
    expect(first.map((event) => event.seq)).toEqual(
      [...first.map((event) => event.seq)].sort((a, b) => a - b),
    );
  });

  it('redacts secrets and strips unsafe escape sequences before storing or streaming', async () => {
    writeFileSync(join(root, '.env'), `DEMO_API_TOKEN=${ENV_SECRET}\n`);
    const { conversationId } = await bypassRun('#term=secret,osc');
    const commands = await commandsOf(conversationId);
    const printed = await storedOutput(named(commands, 'printenv').id);
    expect(printed).toContain('GITHUB_TOKEN=[redacted');
    expect(printed).toContain('HOME=/home/x');
    expect(await storedOutput(named(commands, 'cat banner.txt').id)).toBe('banner\n');
    const { rows } = await t.db.query<{ leaked: string }>(
      `SELECT count(*) AS leaked FROM run_events e JOIN runs r ON r.id = e.run_id
       WHERE r.conversation_id = $1
         AND (e.payload::text LIKE $2 OR e.payload::text LIKE '%]52;%' OR e.payload::text LIKE '%owned%')`,
      [conversationId, `%${FAKE_TERMINAL_SECRET}%`],
    );
    expect(Number(rows[0]!.leaked)).toBe(0);
  });

  it('caps a huge output and keeps its end', async () => {
    const { conversationId } = await bypassRun('#term=huge');
    const [command] = await commandsOf(conversationId);
    const output = await storedOutput(command!.id);
    expect(command!.outputChars).toBeGreaterThan(1_000_000);
    expect(output.length).toBeLessThanOrEqual(COMMAND_STORED_CHARS);
    expect(output.endsWith(`row ${FAKE_HUGE_LINES - 1} ${'x'.repeat(40)}\n`)).toBe(true);
    const events = await commandEvents(conversationId);
    const stored = events
      .filter((event) => event.name === COMMAND_OUTPUT)
      .reduce((sum, event) => sum + String(event.value.chunk).length, 0);
    expect(stored).toBeLessThan(1_300_000);
  });

  it('still marks Bypass tool calls as ran without review', async () => {
    const { conversationId } = await bypassRun('#term=pass');
    const { rows } = await t.db.query(
      `SELECT 1 FROM run_protocol_log l JOIN runs r ON r.id = l.run_id
       WHERE r.conversation_id = $1 AND l.unreviewed
         AND l.payload #>> '{params,update,toolCallId}' = 'term-0'`,
      [conversationId],
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('stored command output', () => {
  async function runningCommand() {
    const conversationId = await openChat(t, { root, level: 'hands-off' });
    const runId = await sendMessage(t, conversationId, BUILD, { permission: 'do' });
    const id = '01990000-0000-7000-8000-000000000001';
    await insertCommand(t.db, runId, {
      id,
      command: 'pnpm dev',
      cwd: './',
      live: true,
      startedAt: new Date().toISOString(),
      textOffset: 0,
      textBefore: '',
      textHeld: 0,
    });
    await saveCommandOutput(t.db, id, 'ready on :5173\n', 15);
    return { conversationId, runId, id };
  }

  it('shows a command as interrupted, with what was captured, when its run ended without it', async () => {
    const { conversationId, runId, id } = await runningCommand();
    expect((await commandsOf(conversationId))[0]).toMatchObject({ status: 'running' });
    await t.db.query(
      `UPDATE runs SET status = 'outcome_unknown', finished_at = now() WHERE id = $1`,
      [runId],
    );
    const [command] = await commandsOf(conversationId);
    expect(command).toMatchObject({ id, status: 'interrupted', exitCode: null, outputChars: 15 });
    expect(command!.finishedAt).not.toBeNull();
    expect(await storedOutput(id)).toBe('ready on :5173\n');
  });

  it('does not let a stale save replace newer output or reopen a finished command', async () => {
    const { id } = await runningCommand();
    await saveCommandOutput(t.db, id, 'older', 5);
    expect(await storedOutput(id)).toBe('ready on :5173\n');
    await t.db.query(`UPDATE run_commands SET status = 'completed' WHERE id = $1`, [id]);
    await saveCommandOutput(t.db, id, 'after the end, much longer text', 31);
    expect(await storedOutput(id)).toBe('ready on :5173\n');
  });

  it('serves the stored output for a run and refuses other ids', async () => {
    const { runId, id } = await runningCommand();
    const client = localClient(createTestApp(t));
    const found = await client.get(`/api/runs/${runId}/commands/${id}/output`);
    expect(found.status).toBe(200);
    expect(found.body).toEqual({ output: 'ready on :5173\n', outputChars: 15 });
    const other = '01990000-0000-7000-8000-00000000ffff';
    expect((await client.get(`/api/runs/${other}/commands/${id}/output`)).status).toBe(404);
    expect((await client.get(`/api/runs/${runId}/commands/nope/output`)).status).toBe(400);
  });
});
