import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversation } from '../src/persistence/conversations.ts';
import { nativeTerminalRow } from '../src/persistence/native-terminals.ts';
import { startSparkMcpHost, type SparkMcpHost } from '../src/spark-mcp/host.ts';
import { EVERYTHING_AVAILABLE } from '../src/spark-mcp/availability.ts';
import {
  createNativeRuntime,
  type NativeRuntime,
  type NativeRuntimeDeps,
} from '../src/terminal/native-runtime.ts';
import type { NativeLaunchInput } from '../src/terminal/native-launch.ts';
import type { PtyOptions, PtyProcess } from '../src/terminal/pty.ts';
import { TerminalSessions } from '../src/terminal/sessions.ts';
import { connectClient, pendingCard, toolDeps } from './spark-mcp-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { clearNativeWriteFailure, failNativeWriteOnce } from './native-terminal-runtime-support.ts';

let t: TestDb;
let folder: string;
let runtime: NativeRuntime;
let host: SparkMcpHost;
let terminals: TerminalSessions;
let conversationId: string;
let inputs: NativeLaunchInput[];
let exits: ((exit: { exitCode: number }) => void)[];
let spawn: ReturnType<typeof vi.fn<(options: PtyOptions) => PtyProcess>>;
let place: NonNullable<NativeRuntimeDeps['place']>;
let prepare: NonNullable<NativeRuntimeDeps['prepareLaunch']>;
const clients: Client[] = [];

beforeEach(async () => {
  t = await createTestDb();
  folder = await realpath(await mkdtemp(join(tmpdir(), 'spark-native-runtime-')));
  conversationId = randomUUID();
  await createConversation(t.db, t.workspaceId, conversationId, {
    sessionType: 'terminal',
    terminalProvider: 'claude',
    title: 'Native fixture',
  });
  await t.db.query(
    `UPDATE conversations SET overrides = '{"claude":{"agentMode":"default","level":"hands-off"}}'::jsonb WHERE id = $1`,
    [conversationId],
  );
  inputs = [];
  exits = [];
  spawn = vi.fn((_options: PtyOptions) => ({
    pid: 999_999_999,
    write: vi.fn(),
    resize: vi.fn(),
    onData: () => undefined,
    onExit: (listener) => {
      exits.push(listener);
    },
  }));
  terminals = new TerminalSessions(spawn);
  host = await startSparkMcpHost(toolDeps(t), async () => ({
    ...EVERYTHING_AVAILABLE,
    browser: false,
  }));
  place = async (_deps, input) => ({
    input: { ...input, projectRoots: [folder] },
    repoRoot: folder,
    note: null,
  });
  prepare = async (input) => {
    inputs.push(input);
    return {
      command: '/fixture/claude',
      args: ['--', input.prompt],
      env: {},
      observation: 'hooks',
      version: '2.1.280',
      dispose: async () => undefined,
    };
  };
  runtime = await createNativeRuntime({
    db: t.db,
    workspaceId: t.workspaceId,
    terminals,
    dataDir: folder,
    channel: 'test',
    mcp: host,
    locateCli: async () => '/fixture/claude',
    place: (...args) => place(...args),
    prepareLaunch: (...args) => prepare(...args),
  });
});

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  await runtime?.dispose();
  terminals?.killAll();
  await host?.close();
  if (t) await clearNativeWriteFailure(t.db);
  await t?.cleanup();
  await rm(folder, { recursive: true, force: true });
});

function launch() {
  return runtime.launch(conversationId, { prompt: 'Check the native fixture', resume: false });
}
async function hook(
  name: string,
  extra: Record<string, unknown> = {},
  token = inputs.at(-1)!.hooks.token,
  eventId = randomUUID(),
) {
  const input = inputs.at(-1)!;
  return fetch(input.hooks.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      sessionId: input.sessionId,
      provider: 'claude',
      eventId,
      payload: {
        hook_event_name: name,
        session_id: 'native-provider-session',
        permission_mode: 'manual',
        ...extra,
      },
    }),
  });
}
async function toolClient() {
  const input = inputs.at(-1)!;
  const client = await connectClient({ ...input.mcp, revoke: () => undefined });
  clients.push(client);
  return client;
}

describe('native terminal integration', () => {
  it('joins the initial launch and waits to attach while its native configuration is preparing', async () => {
    const configure = prepare;
    let release = () => undefined as void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    prepare = async (input) => {
      const configured = await configure(input);
      await paused;
      return configured;
    };
    const first = launch();
    await vi.waitFor(() => expect(inputs).toHaveLength(1));
    const session = (await nativeTerminalRow(t.db, conversationId))!;
    const joining = runtime.launch(conversationId, { resume: false });
    const attached = runtime.attachSession(session.id);
    await expect(
      runtime.launch(conversationId, { prompt: 'Another launch', resume: false }),
    ).rejects.toThrow('This terminal is already starting.');
    expect(spawn).not.toHaveBeenCalled();
    release();
    const [launched, joined, connection] = await Promise.all([first, joining, attached]);
    expect(joined.session.id).toBe(launched.session.id);
    expect(connection?.id).toBe(launched.session.id);
    const client = { output: vi.fn(), send: vi.fn(), close: vi.fn() };
    const stream = terminals.attach(connection!.id, connection!.token, client, {
      cols: 80,
      rows: 24,
    });
    stream.input('Attached after startup\r');
    expect(spawn.mock.results[0]!.value.write).toHaveBeenCalledWith('Attached after startup\r');
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(inputs).toHaveLength(1);
    expect(
      (await t.db.query('SELECT id FROM runs WHERE conversation_id = $1', [conversationId]))
        .rowCount,
    ).toBe(1);
    expect(
      (await t.db.query('SELECT id FROM messages WHERE conversation_id = $1', [conversationId]))
        .rowCount,
    ).toBe(1);
  });

  it('rejects a mismatched native provider before creating messages, runs or terminal state', async () => {
    await expect(
      runtime.launch(conversationId, {
        provider: 'codex',
        prompt: 'Do not mutate this Claude session',
        resume: false,
      }),
    ).rejects.toThrow('Start a new Terminal session to use another agent.');
    expect(spawn).not.toHaveBeenCalled();
    expect(inputs).toHaveLength(0);
    expect(await nativeTerminalRow(t.db, conversationId)).toBeNull();
    expect(
      (await t.db.query('SELECT id FROM messages WHERE conversation_id = $1', [conversationId]))
        .rowCount,
    ).toBe(0);
    expect(
      (await t.db.query('SELECT id FROM runs WHERE conversation_id = $1', [conversationId]))
        .rowCount,
    ).toBe(0);
  });

  it('cancels a pending launch before a slow workspace placement can spawn the agent', async () => {
    let enter = () => undefined as void;
    let release = () => undefined as void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    place = async (_deps, input) => {
      enter();
      await released;
      return { input: { ...input, projectRoots: [folder] }, repoRoot: folder, note: null };
    };
    const pending = launch().catch((error: unknown) => error);
    await entered;
    const stopping = runtime.stop(conversationId);
    await vi.waitFor(async () => {
      const { rows } = await t.db.query<{ cancel_requested_at: Date | null }>(
        'SELECT cancel_requested_at FROM runs WHERE conversation_id = $1',
        [conversationId],
      );
      expect(rows[0]?.cancel_requested_at).not.toBeNull();
    });
    release();
    expect(await pending).toMatchObject({
      message: 'This terminal launch was stopped.',
      status: 409,
    });
    await stopping;
    expect(spawn).not.toHaveBeenCalled();
    expect(inputs).toHaveLength(0);
    expect(await nativeTerminalRow(t.db, conversationId)).toBeNull();
    const { rows } = await t.db.query<{ status: string }>(
      'SELECT status FROM runs WHERE conversation_id = $1',
      [conversationId],
    );
    expect(rows).toEqual([{ status: 'cancelled' }]);
  });

  it('reuses a running launch and exposes authenticated, scoped activity through real HTTP hooks', async () => {
    const first = await launch();
    const again = await runtime.launch(conversationId, { resume: false });
    expect(again.session.id).toBe(first.session.id);
    expect(spawn).toHaveBeenCalledTimes(1);
    const denied = await hook('UserPromptSubmit', { prompt: 'wrong token' }, 'incorrect-token');
    expect(denied.status).toBe(401);
    expect((await hook('SessionStart')).status).toBe(204);
    expect(
      (await hook('UserPromptSubmit', { prompt: 'A new native turn', turn_id: 'turn-1' })).status,
    ).toBe(204);
    expect((await runtime.get(conversationId))?.state).toBe('working');
    await hook('PermissionRequest');
    expect((await runtime.get(conversationId))?.state).toBe('waiting_for_permission');
    await hook('PostToolUse');
    await hook('Stop');
    expect((await runtime.get(conversationId))?.state).toBe('ready');
  });

  it('deduplicates prompt callbacks and ignores completion and tools from a previous native turn', async () => {
    await launch();
    await hook('SessionStart');
    const eventId = randomUUID();
    const first = { prompt: 'First prompt', turn_id: 'first-turn' };
    expect((await hook('UserPromptSubmit', first, undefined, eventId)).status).toBe(204);
    expect((await hook('UserPromptSubmit', first, undefined, eventId)).status).toBe(204);
    expect(
      (await t.db.query('SELECT id FROM runs WHERE conversation_id = $1', [conversationId]))
        .rowCount,
    ).toBe(1);
    await hook('Stop', { turn_id: 'first-turn' });
    await hook('UserPromptSubmit', { prompt: 'Second prompt', turn_id: 'second-turn' });
    await hook('Stop', { turn_id: 'first-turn' });
    await hook('PreToolUse', { turn_id: 'first-turn', tool_name: 'AskUserQuestion' });
    expect((await runtime.get(conversationId))?.state).toBe('working');
    const { rows } = await t.db.query<{ status: string }>(
      'SELECT status FROM runs WHERE conversation_id = $1 ORDER BY created_at',
      [conversationId],
    );
    expect(rows).toEqual([{ status: 'succeeded' }, { status: 'running' }]);
    await hook('Stop', { turn_id: 'second-turn' });
    expect((await runtime.get(conversationId))?.state).toBe('ready');
  });

  it('retries a callback after a transient database failure without duplicating its run', async () => {
    await launch();
    await hook('SessionStart');
    await failNativeWriteOnce(t.db, 'working');
    const eventId = randomUUID();
    const payload = { prompt: 'Retry the same callback', turn_id: 'retry-turn' };
    expect((await hook('UserPromptSubmit', payload, undefined, eventId)).status).toBe(500);
    expect((await hook('UserPromptSubmit', payload, undefined, eventId)).status).toBe(204);
    expect((await runtime.get(conversationId))?.state).toBe('working');
    expect(
      (await t.db.query('SELECT id FROM runs WHERE conversation_id = $1', [conversationId]))
        .rowCount,
    ).toBe(1);
    expect(
      (
        await t.db.query('SELECT event_id FROM native_terminal_events WHERE event_id = $1', [
          eventId,
        ])
      ).rowCount,
    ).toBe(1);
  });

  it.each([true, false])(
    'fences a retried partial completion from the next prompt with native turn ids: %s',
    async (withIds) => {
      await launch();
      await hook('SessionStart');
      const firstTurn = withIds ? { turn_id: 'first-turn' } : {};
      const secondTurn = withIds ? { turn_id: 'second-turn' } : {};
      await hook('UserPromptSubmit', { prompt: 'First prompt', ...firstTurn });
      await failNativeWriteOnce(t.db, 'ready');
      const stopEventId = randomUUID();
      const firstStop = firstTurn;
      expect((await hook('Stop', firstStop, undefined, stopEventId)).status).toBe(500);
      expect(
        (await t.db.query('SELECT status FROM runs WHERE conversation_id = $1', [conversationId]))
          .rows,
      ).toEqual([{ status: 'succeeded' }]);
      expect(
        (await hook('UserPromptSubmit', { prompt: 'Second prompt', ...secondTurn })).status,
      ).toBe(204);
      expect((await hook('Stop', firstStop, undefined, stopEventId)).status).toBe(204);
      expect((await runtime.get(conversationId))?.state).toBe('working');
      const { rows } = await t.db.query<{ status: string }>(
        'SELECT status FROM runs WHERE conversation_id = $1 ORDER BY created_at',
        [conversationId],
      );
      expect(rows).toEqual([{ status: 'succeeded' }, { status: 'running' }]);
      expect((await nativeTerminalRow(t.db, conversationId))?.native_turn_id).toBe(
        withIds ? 'second-turn' : null,
      );
      await hook('Stop', secondTurn);
      expect((await runtime.get(conversationId))?.state).toBe('ready');
    },
  );

  it('finishes the original run before a new prompt replaces a failed completion transaction', async () => {
    await launch();
    await hook('SessionStart');
    await hook('UserPromptSubmit', { prompt: 'First prompt' });
    await failNativeWriteOnce(t.db, 'succeeded');
    const stopEventId = randomUUID();
    expect((await hook('Stop', {}, undefined, stopEventId)).status).toBe(500);
    expect(
      (await t.db.query('SELECT status FROM runs WHERE conversation_id = $1', [conversationId]))
        .rows,
    ).toEqual([{ status: 'running' }]);
    expect((await hook('UserPromptSubmit', { prompt: 'Second prompt' })).status).toBe(204);
    expect((await hook('Stop', {}, undefined, stopEventId)).status).toBe(204);
    const { rows } = await t.db.query<{ id: string; status: string }>(
      'SELECT id, status FROM runs WHERE conversation_id = $1 ORDER BY created_at',
      [conversationId],
    );
    expect(rows.map((row) => row.status)).toEqual(['outcome_unknown', 'running']);
    expect((await nativeTerminalRow(t.db, conversationId))?.active_run_id).toBe(rows[1]?.id);
    expect((await runtime.get(conversationId))?.state).toBe('working');
    await hook('Stop');
    expect((await runtime.get(conversationId))?.state).toBe('ready');
  });

  it('keeps eight simultaneous sessions isolated when one asks for permission or stops', async () => {
    const ids = [conversationId, ...Array.from({ length: 7 }, () => randomUUID())];
    for (const id of ids.slice(1))
      await createConversation(t.db, t.workspaceId, id, {
        sessionType: 'terminal',
        terminalProvider: 'claude',
        title: `Concurrent ${id}`,
      });
    const launches = await Promise.all(
      ids.map((id) => runtime.launch(id, { prompt: 'Concurrent fixture', resume: false })),
    );
    expect(spawn).toHaveBeenCalledTimes(8);
    expect(terminals.activeCount).toBe(8);
    for (const launch of launches) {
      const input = inputs.find((entry) => entry.sessionId === launch.session.id)!;
      for (const name of ['SessionStart', 'UserPromptSubmit']) {
        const response = await fetch(input.hooks.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${input.hooks.token}`,
          },
          body: JSON.stringify({
            sessionId: input.sessionId,
            provider: 'claude',
            eventId: randomUUID(),
            payload: {
              hook_event_name: name,
              session_id: `provider-${input.sessionId}`,
              permission_mode: 'manual',
              prompt: 'Concurrent fixture',
            },
          }),
        });
        expect(response.status).toBe(204);
      }
    }
    expect(await Promise.all(ids.map(async (id) => (await runtime.get(id))?.state))).toEqual(
      Array(8).fill('working'),
    );
    const firstInput = inputs.find((entry) => entry.sessionId === launches[0]!.session.id)!;
    await fetch(firstInput.hooks.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${firstInput.hooks.token}`,
      },
      body: JSON.stringify({
        sessionId: firstInput.sessionId,
        provider: 'claude',
        eventId: randomUUID(),
        payload: {
          hook_event_name: 'PermissionRequest',
          session_id: `provider-${firstInput.sessionId}`,
          permission_mode: 'manual',
        },
      }),
    });
    expect((await runtime.get(ids[0]!))?.state).toBe('waiting_for_permission');
    await runtime.stop(ids[0]!);
    expect(terminals.activeCount).toBe(7);
    expect((await runtime.get(ids[0]!))?.state).toBe('exited');
    expect(
      await Promise.all(ids.slice(1).map(async (id) => (await runtime.get(id))?.state)),
    ).toEqual(Array(7).fill('working'));
  });

  it('uses Spark tools from the native grant and creates a real backend confirmation for an action', async () => {
    await launch();
    await hook('SessionStart');
    await hook('UserPromptSubmit', {
      prompt: 'Read terminals and add a Spark',
      turn_id: 'native-tools',
    });
    const client = await toolClient();
    const listed = await client.callTool({ name: 'spark_terminals', arguments: {} });
    expect(listed.isError).not.toBe(true);
    const called = client.callTool({
      name: 'spark_create_spark',
      arguments: { name: 'Native helper' },
    });
    const card = await pendingCard(t);
    expect(card.kind).toBe('spark_action');
    expect(
      (
        await t.db.query<{ conversation_id: string }>(
          'SELECT conversation_id FROM runs WHERE id = $1',
          [card.runId],
        )
      ).rows[0]?.conversation_id,
    ).toBe(conversationId);
    expect(card.payload.sparkAction?.action).toBe('create_teammate');
    await runtime.stop(conversationId);
    await called;
    expect((await runtime.get(conversationId))?.state).toBe('exited');
  });

  it('requires explicit resume and ignores the previous generation credentials and exit callback', async () => {
    const first = await launch();
    await hook('SessionStart');
    const oldInput = inputs[0]!;
    const oldExit = exits[0]!;
    await runtime.stop(conversationId);
    oldExit({ exitCode: 0 });
    const resumed = await runtime.launch(conversationId, { resume: true });
    expect(resumed.session.id).toBe(first.session.id);
    expect(inputs.at(-1)!.resumeSessionId).toBe('native-provider-session');
    expect(spawn).toHaveBeenCalledTimes(2);
    const stale = await fetch(oldInput.hooks.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${oldInput.hooks.token}`,
      },
      body: JSON.stringify({
        sessionId: oldInput.sessionId,
        provider: 'claude',
        eventId: randomUUID(),
        payload: { hook_event_name: 'Stop' },
      }),
    });
    expect(stale.status).toBe(401);
    oldExit({ exitCode: 7 });
    await hook('SessionStart');
    expect((await nativeTerminalRow(t.db, conversationId))!.generation).toBe(2);
    expect((await runtime.get(conversationId))?.state).not.toBe('error');
  });
});
