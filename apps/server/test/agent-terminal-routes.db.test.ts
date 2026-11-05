import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agentTerminalListSchema,
  agentTerminalSchema,
  commandOutputResponseSchema,
  createShellResponseSchema,
  type TerminalServerMessage,
} from '@spark-outpost/contracts';
import { agentTerminalRow, startAgentTerminal } from '../src/persistence/agent-terminals.ts';
import { AgentTerminals } from '../src/terminal/agent-terminals.ts';
import { loginShellSpawner } from '../src/terminal/pty.ts';
import { TerminalAuthError, TerminalSessions } from '../src/terminal/sessions.ts';
import {
  FAST_AGENT_TERMINALS,
  fakeAgentTerminalRuntime,
  type FakeAgentTerminalRuntime,
} from './agent-terminal-support.ts';
import { createTestApp, localClient } from './app-support.ts';
import { doRun, type LinkedRun } from './approval-support.ts';
import { pairDevice, remoteClient, turnRemoteOn } from './remote-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let chat: LinkedRun;
let fake: FakeAgentTerminalRuntime;
let runner: AgentTerminals;
let terminals: TerminalSessions;
let app: ReturnType<typeof createTestApp>;
let client: ReturnType<typeof localClient>;
let calls = 0;

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-agent-routes-')));
  chat = await doRun(t, base);
  fake = fakeAgentTerminalRuntime();
  runner = new AgentTerminals(t.db, t.workspaceId, fake.runtime, FAST_AGENT_TERMINALS);
  terminals = new TerminalSessions(loginShellSpawner('/bin/sh'));
  app = createTestApp(t, { terminals, agentTerminals: runner });
  client = localClient(app);
});

afterEach(async () => {
  terminals.killAll();
  await runner.stopAll();
  await rm(base, { recursive: true, force: true });
  await t.cleanup();
});

async function running(runId = chat.runId) {
  calls += 1;
  const started = await startAgentTerminal(t.db, {
    runId,
    toolCallId: `route-${calls}`,
    name: 'pnpm dev',
    command: 'pnpm dev',
    cwd: base,
    decidedBy: 'mode',
    approvalId: null,
    textOffset: 4,
    textBefore: 'Okay',
    textHeld: 0,
  });
  await runner.sync();
  return started!.row;
}

const at = (id: string, rest = '', conversationId = chat.conversationId) =>
  `/api/conversations/${conversationId}/agent-terminals/${id}${rest}`;

function tab() {
  const seen = { output: '', messages: [] as TerminalServerMessage[], closed: false };
  return {
    seen,
    output: (data: string) => {
      seen.output += data;
    },
    send: (message: TerminalServerMessage) => {
      seen.messages.push(message);
    },
    close: () => {
      seen.closed = true;
    },
  };
}

describe('the agent terminals of a chat', () => {
  it('lists them with their state, oldest first, and nothing for another chat', async () => {
    const first = await running();
    const second = await running();
    fake.spawned[1]!.exit(2);
    await eventually(async () => (await agentTerminalRow(t.db, second.id))?.status === 'exited');

    const response = await client
      .get(`/api/conversations/${chat.conversationId}/agent-terminals`)
      .expect(200);
    const { terminals: listed } = agentTerminalListSchema.parse(response.body);
    expect(listed.map((terminal) => [terminal.id, terminal.state, terminal.exitCode])).toEqual([
      [first.id, 'running', null],
      [second.id, 'exited', 2],
    ]);
    expect(listed[0]).toMatchObject({ command: 'pnpm dev', cwd: base, textBefore: 'Okay' });
    expect(response.body.terminals[0]).not.toHaveProperty('output');
    expect(response.body.terminals[0]).not.toHaveProperty('pid');

    const other = await doRun(t, await realpath(await mkdtemp(path.join(base, 'other-'))));
    const empty = await client
      .get(`/api/conversations/${other.conversationId}/agent-terminals`)
      .expect(200);
    expect(empty.body).toEqual({ terminals: [] });
  });

  it('reads the saved output of one terminal', async () => {
    const row = await running();
    fake.spawned[0]!.print('listening\n');
    fake.spawned[0]!.exit(0);
    await eventually(async () => (await agentTerminalRow(t.db, row.id))?.status === 'exited');
    const response = await client.get(at(row.id, '/output')).expect(200);
    expect(commandOutputResponseSchema.parse(response.body)).toEqual({
      output: 'listening\n',
      outputChars: 10,
    });
  });

  it('does not find a terminal through another chat or with a bad id', async () => {
    const row = await running();
    const other = await doRun(t, await realpath(await mkdtemp(path.join(base, 'other-'))));
    await client.get(at(row.id, '/output', other.conversationId)).expect(404);
    await client.send('post', at(row.id, '/view', other.conversationId)).expect(404);
    await client.send('post', at(row.id, '/stop', other.conversationId)).expect(404);
    await client.get(at('not-an-id', '/output')).expect(400);
    expect(fake.spawned[0]!.killed).toBe(false);
  });
});

describe('watching an agent terminal from the dock', () => {
  it('opens a view that replays what was printed, goes on live and takes no typing', async () => {
    const row = await running();
    fake.spawned[0]!.print('first\r\n');
    const response = await client.send('post', at(row.id, '/view')).expect(201);
    const view = createShellResponseSchema.parse(response.body);
    expect(view).toMatchObject({ cwd: base, label: 'pnpm dev', kind: 'project', note: null });

    const dock = tab();
    const attached = terminals.attach(view.id, view.token, dock, { cols: 100, rows: 30 });
    expect(dock.seen.output).toBe('first\r\n');
    fake.spawned[0]!.print('second\r\n');
    expect(dock.seen.output).toBe('first\r\nsecond\r\n');

    attached.input('echo typed\r');
    expect(fake.spawned[0]!.written).toEqual([]);

    fake.spawned[0]!.exit(0);
    await eventually(async () => dock.seen.closed);
    expect(dock.seen.messages).toEqual([{ type: 'ended', reason: 'exited', exitCode: null }]);
  });

  it('keeps the command running when the tab closes', async () => {
    const row = await running();
    const view = (await client.send('post', at(row.id, '/view')).expect(201)).body;
    terminals.attach(view.id, view.token, tab(), { cols: 100, rows: 30 }).close();
    expect(fake.spawned[0]!.killed).toBe(false);
    expect((await agentTerminalRow(t.db, row.id))?.status).toBe('running');
    await client.send('post', at(row.id, '/view')).expect(201);
  });

  it('answers 409 for a terminal that is not running any more', async () => {
    const row = await running();
    fake.spawned[0]!.exit(0);
    await eventually(async () => (await agentTerminalRow(t.db, row.id))?.status === 'exited');
    const response = await client.send('post', at(row.id, '/view')).expect(409);
    expect(response.body.error).toMatch(/not running/);
  });

  it('refuses a view whose terminal ended before the tab attached', async () => {
    const row = await running();
    const view = (await client.send('post', at(row.id, '/view')).expect(201)).body;
    fake.spawned[0]!.exit(0);
    await eventually(async () => (await agentTerminalRow(t.db, row.id))?.status === 'exited');
    expect(() => terminals.attach(view.id, view.token, tab(), { cols: 80, rows: 24 })).toThrow(
      TerminalAuthError,
    );
  });
});

describe('Stop from the user', () => {
  it('kills the process and answers with the stopped terminal', async () => {
    const row = await running();
    const response = await client.send('post', at(row.id, '/stop')).expect(200);
    expect(agentTerminalSchema.parse(response.body)).toMatchObject({
      id: row.id,
      state: 'stopped',
      stoppedBy: 'user',
    });
    expect(fake.spawned[0]!.killed).toBe(true);
  });

  it('answers with the ended terminal, unchanged, when it is stopped again', async () => {
    const row = await running();
    fake.spawned[0]!.exit(1);
    await eventually(async () => (await agentTerminalRow(t.db, row.id))?.status === 'exited');
    const response = await client.send('post', at(row.id, '/stop')).expect(200);
    expect(response.body).toMatchObject({ state: 'exited', exitCode: 1, stoppedBy: null });
  });

  it('has no route that sends input', async () => {
    const row = await running();
    await client.send('post', at(row.id, '/input'), { data: 'ls\r' }).expect(404);
  });
});

describe('a paired phone', () => {
  it('reads the state as text and can neither watch, read output nor stop', async () => {
    const row = await running();
    await turnRemoteOn(app);
    const phone = remoteClient(app, (await pairDevice(app)).cookie);

    const listed = await phone
      .get(`/api/conversations/${chat.conversationId}/agent-terminals`)
      .expect(200);
    expect(agentTerminalListSchema.parse(listed.body).terminals[0]).toMatchObject({
      id: row.id,
      state: 'running',
    });
    await phone.get(at(row.id, '/output')).expect(403);
    await phone.send('post', at(row.id, '/view')).expect(403);
    await phone.send('post', at(row.id, '/stop')).expect(403);
    expect(fake.spawned[0]!.killed).toBe(false);
    expect((await agentTerminalRow(t.db, row.id))?.status).toBe('running');
  });
});
