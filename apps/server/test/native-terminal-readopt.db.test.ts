import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConversation } from '../src/persistence/conversations.ts';
import { nativeTerminalRow } from '../src/persistence/native-terminals.ts';
import { EVERYTHING_AVAILABLE } from '../src/spark-mcp/availability.ts';
import { startSparkMcpHost, type SparkMcpHost } from '../src/spark-mcp/host.ts';
import type { NativeLaunchInput } from '../src/terminal/native-launch.ts';
import {
  createNativeRuntime,
  type NativeRuntime,
  type NativeRuntimeDeps,
} from '../src/terminal/native-runtime.ts';
import { insertChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { pendingDir } from '../src/terminal/session-deps.ts';
import { isAlive } from '../src/terminal/process-group.ts';
import { loginShellSpawner } from '../src/terminal/pty.ts';
import { TerminalSessions } from '../src/terminal/sessions.ts';
import {
  chooseTmux,
  killTmuxServer,
  tryTmux,
  type TmuxHost,
} from '../src/terminal/tmux/tmux-host.ts';
import { tmuxSpawner } from '../src/terminal/tmux/tmux-spawner.ts';
import {
  createSession,
  listSessionIds,
  readPane,
  sessionName,
} from '../src/terminal/tmux/tmux-session.ts';
import { connectClient, toolDeps } from './spark-mcp-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const built = resolve(import.meta.dirname, '../../..', '.local/tmux', process.arch, 'bin/tmux');
const bin = process.env.SPARK_TMUX_BIN || (existsSync(built) ? built : null);
const LOOP = 'echo started; while IFS= read -r line; do [ "$line" = quit ] && exit 4; done';

interface World {
  runtime: NativeRuntime;
  terminals: TerminalSessions;
  mcp: SparkMcpHost;
}

async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

describe.skipIf(!bin)('Terminal sessions across a Spark restart', () => {
  let t: TestDb;
  let folder: string;
  let tmux: TmuxHost;
  let conversationId: string;
  let inputs: (NativeLaunchInput & { directory: string })[];
  const worlds: World[] = [];
  let prepareDependencies: NonNullable<NativeRuntimeDeps['prepareDependencies']> = async () => null;

  const start = async (port = 0): Promise<World> => {
    const terminals = new TerminalSessions(tmuxSpawner(loginShellSpawner(), tmux));
    const mcp = await startSparkMcpHost(
      toolDeps(t),
      async () => ({ ...EVERYTHING_AVAILABLE, browser: false }),
      port,
    );
    const runtime = await createNativeRuntime({
      db: t.db,
      workspaceId: t.workspaceId,
      terminals,
      dataDir: folder,
      channel: 'test',
      mcp,
      tmux,
      now: () => new Date('2026-10-13T07:14:00.000Z'),
      prepareDependencies: (...args) => prepareDependencies(...args),
      locateCli: async () => '/bin/sh',
      place: async (_deps, input) => ({
        input: { ...input, projectRoots: [folder] },
        repoRoot: folder,
        note: null,
      }),
      prepareLaunch: async (input) => {
        const directory = join(folder, 'test/terminal-sessions', input.sessionId, randomUUID());
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, 'observer.json'), JSON.stringify(input.hooks));
        inputs.push({ ...input, directory });
        return {
          command: '/bin/sh',
          args: ['-c', LOOP],
          env: {},
          observation: 'hooks',
          version: 'fixture',
          directory,
          dispose: () => rm(directory, { recursive: true, force: true }),
        };
      },
    });
    const world = { runtime, terminals, mcp };
    worlds.push(world);
    return world;
  };
  const restart = async (from: World): Promise<World> => {
    await from.runtime.detach();
    await from.mcp.close();
    worlds.splice(worlds.indexOf(from), 1);
    const next = await start(from.mcp.port);
    await next.runtime.recover();
    return next;
  };
  const hook = async (name: string, extra: Record<string, unknown> = {}) => {
    const input = inputs.at(-1)!;
    const observer = JSON.parse(readFileSync(join(input.directory, 'observer.json'), 'utf8')) as {
      url: string;
      token: string;
    };
    const response = await fetch(observer.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${observer.token}` },
      body: JSON.stringify({
        sessionId: input.sessionId,
        provider: 'claude',
        eventId: randomUUID(),
        payload: {
          hook_event_name: name,
          session_id: 'native-provider-session',
          permission_mode: 'manual',
          ...extra,
        },
      }),
    });
    return response.status;
  };
  const row = async () => (await nativeTerminalRow(t.db, conversationId))!;
  const runStatus = async () =>
    (
      await t.db.query<{ status: string }>(
        'SELECT status FROM runs WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1',
        [conversationId],
      )
    ).rows[0]?.status;
  const launched = async (world: World) => {
    await world.runtime.launch(conversationId, { prompt: 'Check the fixture', resume: false });
    const id = (await row()).id;
    await until(() => readPane(tmux, id)?.dead === false, 'the session');
    return { id, pid: readPane(tmux, id)!.pid };
  };

  beforeEach(async () => {
    t = await createTestDb();
    folder = mkdtempSync(join(tmpdir(), 'sptx-db-'));
    const choice = chooseTmux({ ...process.env, SPARK_TMUX_BIN: bin! }, join(folder, 'tmux'), null);
    if (!choice.host) throw new Error(choice.reason);
    tmux = choice.host;
    conversationId = randomUUID();
    inputs = [];
    await createConversation(t.db, t.workspaceId, conversationId, {
      sessionType: 'terminal',
      terminalProvider: 'claude',
      title: 'Restart fixture',
    });
    await t.db.query(
      `UPDATE conversations SET overrides = '{"claude":{"agentMode":"default","level":"hands-off"}}'::jsonb WHERE id = $1`,
      [conversationId],
    );
  });

  afterEach(async () => {
    for (const world of worlds.splice(0)) {
      await world.runtime.dispose().catch(() => undefined);
      world.terminals.killAll();
      await world.mcp.close();
    }
    killTmuxServer(tmux);
    await t.cleanup();
    await rm(folder, { recursive: true, force: true });
  });

  it('finishes dependency preparation that a restart interrupted, and says so until it is done', async () => {
    execFileSync('git', ['-C', folder, 'init', '-q', '-b', 'main']);
    await writeFile(join(folder, 'package.json'), '{"name":"app"}');
    const projectId = randomUUID();
    await t.db.query(
      `INSERT INTO projects (id, workspace_id, name, root_path) VALUES ($1, $2, 'app', $3)`,
      [projectId, t.workspaceId, join(folder, 'main')],
    );
    await insertChatWorktree(t.db, {
      id: randomUUID(),
      conversationId,
      projectId,
      repoRoot: join(folder, 'main'),
      path: folder,
      branch: 'spark/fixture',
      baseBranch: 'main',
      baseCommit: '',
      landedCommit: null,
      inPlace: false,
      ownsBranch: true,
    });
    const first = await start();
    await launched(first);
    expect((await first.runtime.get(conversationId))?.dependencies).toBeNull();
    const marker = (await pendingDir(folder))!;
    await mkdir(marker, { recursive: true });
    let finish: () => void = () => undefined;
    const calls: string[][] = [];
    prepareDependencies = (main, copy) =>
      new Promise((resolve) => {
        calls.push([main, copy]);
        finish = () => resolve(null);
      });

    const second = await restart(first);

    await until(() => calls.length === 1, 'the dependency step to start again');
    expect(calls).toEqual([[join(folder, 'main'), folder]]);
    expect(await second.runtime.get(conversationId)).toMatchObject({
      readopted: { at: '2026-10-13T07:14:00.000Z' },
      dependencies: { state: 'preparing' },
    });
    finish();
    await until(
      async () => (await second.runtime.get(conversationId))?.dependencies === null,
      'the notice to clear',
    );
    expect(existsSync(marker)).toBe(false);
  });

  it('adopts a running session with its turn, hooks and Spark tools after a restart', async () => {
    const first = await start();
    const { id, pid } = await launched(first);
    expect(await hook('SessionStart')).toBe(204);
    expect(await hook('UserPromptSubmit', { prompt: 'Check the fixture', prompt_id: 'p1' })).toBe(
      204,
    );
    const before = inputs[0]!;

    const second = await restart(first);

    expect(readPane(tmux, id)).toMatchObject({ pid, dead: false });
    expect(await second.runtime.get(conversationId)).toMatchObject({
      state: 'unknown',
      readopted: { at: '2026-10-13T07:14:00.000Z', stepsComplete: false },
    });
    expect(await runStatus()).toBe('running');
    const stale = await fetch(before.hooks.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${before.hooks.token}` },
      body: '{}',
    }).then(
      (response) => response.status,
      () => 0,
    );
    expect([0, 401]).toContain(stale);
    expect(
      await hook('PreToolUse', { tool_name: 'Read', tool_use_id: 't1', prompt_id: 'p1' }),
    ).toBe(204);
    const client = await connectClient({ ...before.mcp, revoke: () => undefined });
    const listed = await client.callTool({ name: 'spark_terminals', arguments: {} });
    await client.close();
    expect(listed.isError).not.toBe(true);
    expect(await hook('Stop', { prompt_id: 'p1' })).toBe(204);
    expect(await runStatus()).toBe('succeeded');
    expect((await row()).state).toBe('ready');

    await second.runtime.stop(conversationId);
    await until(() => !isAlive(pid), 'the command to stop');
    expect(listSessionIds(tmux)).toEqual([]);
    expect((await row()).state).toBe('exited');
    expect(existsSync(join(folder, 'test/terminal-sessions', id))).toBe(false);
  });

  it('catches up the steps and tokens the CLI recorded while Spark was down', async () => {
    const transcript = join(folder, 'native-provider-session.jsonl');
    await writeFile(transcript, '');
    const first = await start();
    await launched(first);
    await hook('UserPromptSubmit', {
      prompt: 'Check the fixture',
      prompt_id: 'p1',
      transcript_path: transcript,
    });
    await first.runtime.detach();
    await first.mcp.close();
    worlds.splice(worlds.indexOf(first), 1);
    const usage = { input_tokens: 40, output_tokens: 9 };
    const records = [
      {
        type: 'assistant',
        timestamp: '2026-10-13T07:10:00.000Z',
        message: {
          id: 'm1',
          model: 'claude-sonnet-4-5',
          usage,
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read' }],
        },
      },
      {
        type: 'user',
        promptId: 'p1',
        timestamp: '2026-10-13T07:10:02.000Z',
        message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true }] },
      },
    ];
    await writeFile(transcript, records.map((record) => `${JSON.stringify(record)}\n`).join(''));

    const second = await start(first.mcp.port);
    await second.runtime.recover();

    expect((await second.runtime.get(conversationId))?.readopted?.stepsComplete).toBe(true);
    const steps = async () =>
      (
        await t.db.query<{
          name: string;
          started_at: Date;
          ended_at: Date | null;
          failed: boolean;
        }>(
          `SELECT s.name, s.started_at, s.ended_at, s.failed FROM native_terminal_steps s
           JOIN runs r ON r.id = s.run_id WHERE r.conversation_id = $1`,
          [conversationId],
        )
      ).rows;
    await until(async () => (await steps())[0]?.ended_at != null, 'the missed step');
    expect(await steps()).toEqual([
      {
        name: 'Read',
        started_at: new Date('2026-10-13T07:10:00.000Z'),
        ended_at: new Date('2026-10-13T07:10:02.000Z'),
        failed: true,
      },
    ]);
    await until(async () => {
      const { rows } = await t.db.query<{ output_tokens: number | null }>(
        'SELECT output_tokens FROM runs WHERE conversation_id = $1',
        [conversationId],
      );
      return Number(rows[0]?.output_tokens) === 9;
    }, 'the missed tokens');
  });

  it('never writes the Spark tools token next to the session, only its digest', async () => {
    const world = await start();
    await launched(world);
    const input = inputs[0]!;
    const record = readFileSync(join(input.directory, 'adopt.json'), 'utf8');
    expect(record).not.toContain(input.mcp.token);
    expect(JSON.parse(record)).toMatchObject({ ceiling: 'default', mcpPort: world.mcp.port });
  });

  it('marks a session interrupted when its tmux server died while Spark was down', async () => {
    const first = await start();
    const { pid } = await launched(first);
    await hook('UserPromptSubmit', { prompt: 'Check the fixture', prompt_id: 'p1' });
    await first.runtime.detach();
    killTmuxServer(tmux);
    await until(() => !isAlive(pid), 'the command to stop');
    const second = await start(first.mcp.port);
    await second.runtime.recover();
    expect((await row()).state).toBe('interrupted');
    expect(await runStatus()).toBe('outcome_unknown');
    expect((await second.runtime.get(conversationId))?.readopted ?? null).toBeNull();
  });

  it('kills a tmux session that has no terminal row', async () => {
    const stray = randomUUID();
    const pane = createSession(tmux, {
      sessionId: stray,
      cols: 80,
      rows: 24,
      cwd: folder,
      command: '/bin/sleep',
      args: ['300'],
      env: {},
    });
    tryTmux(tmux, ['send-keys', '-t', `=${sessionName(stray)}:`, '-H', '0a']);
    const world = await start();
    await world.runtime.recover();
    expect(listSessionIds(tmux)).toEqual([]);
    await until(() => !isAlive(pane.pid), 'the stray command to stop');
  });

  it('records the real exit of a command that ended while Spark was down', async () => {
    const first = await start();
    const { id } = await launched(first);
    await first.runtime.detach();
    tryTmux(tmux, ['send-keys', '-t', `=${sessionName(id)}:`, 'quit', 'Enter']);
    await until(() => readPane(tmux, id)?.dead === true, 'the command to end');
    const second = await start(first.mcp.port);
    await second.runtime.recover();
    await until(async () => (await row()).state === 'error', 'the exit to be recorded');
    expect((await row()).reason).toBe('Native agent exited (4).');
    expect(listSessionIds(tmux)).toEqual([]);
  });

  it('keeps an idle session idle, with nothing to catch up', async () => {
    const first = await start();
    await launched(first);
    await hook('UserPromptSubmit', { prompt: 'Check the fixture', prompt_id: 'p1' });
    await hook('Stop', { prompt_id: 'p1' });
    const second = await restart(first);
    expect(await second.runtime.get(conversationId)).toMatchObject({
      state: 'ready',
      readopted: { stepsComplete: true },
    });
  });

  it('adopts a session once and refuses a second recovery', async () => {
    const first = await start();
    const { id, pid } = await launched(first);
    const second = await restart(first);
    await expect(second.runtime.recover()).rejects.toThrow('stopped terminal host');
    expect(readPane(tmux, id)).toMatchObject({ pid, dead: false });
    expect(listSessionIds(tmux)).toEqual([id]);
  });

  it('stops every session and the tmux server when Spark quits', async () => {
    const world = await start();
    const { pid } = await launched(world);
    await world.runtime.dispose();
    await until(() => !isAlive(pid), 'the command to stop');
    expect(listSessionIds(tmux)).toEqual([]);
    expect((await row()).state).toBe('exited');
  });
});
