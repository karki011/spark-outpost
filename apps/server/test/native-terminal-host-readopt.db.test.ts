import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConversation } from '../src/persistence/conversations.ts';
import { nativeTerminalRow } from '../src/persistence/native-terminals.ts';
import { childEnvironment } from '../src/setup/environment.ts';
import { EVERYTHING_AVAILABLE } from '../src/spark-mcp/availability.ts';
import { startSparkMcpHost, type SparkMcpHost } from '../src/spark-mcp/host.ts';
import type { KeptSessions } from '../src/terminal/kept-sessions.ts';
import type { NativeLaunchInput } from '../src/terminal/native-launch.ts';
import { createNativeRuntime, type NativeRuntime } from '../src/terminal/native-runtime.ts';
import { isAlive } from '../src/terminal/process-group.ts';
import { loginShellSpawner } from '../src/terminal/pty.ts';
import { HOST_ENTRY } from '../src/terminal/session-host/host-launch.ts';
import { withHostConnection } from '../src/terminal/session-host/host-connection.ts';
import { hostKept } from '../src/terminal/session-host/host-kept.ts';
import { sessionHostPaths } from '../src/terminal/session-host/paths.ts';
import { listedSchema } from '../src/terminal/session-host/protocol.ts';
import { TerminalSessions } from '../src/terminal/sessions.ts';
import { toolDeps } from './spark-mcp-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const LOOP = [
  "process.stdout.write('started\\n');",
  "process.stdin.on('data', (d) => { if (String(d).includes('quit')) process.exit(4); });",
].join(' ');

interface World {
  runtime: NativeRuntime;
  terminals: TerminalSessions;
  mcp: SparkMcpHost;
  kept: KeptSessions;
}

async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

describe('Terminal sessions under the session host across a Spark restart', () => {
  let t: TestDb;
  let folder: string;
  let conversationId: string;
  let inputs: (NativeLaunchInput & { directory: string })[];
  const worlds: World[] = [];

  const keptSessions = () =>
    hostKept(
      {
        paths: sessionHostPaths(join(folder, 'host')),
        launcher: {
          file: process.execPath,
          args: ['--import', 'tsx', HOST_ENTRY],
          env: childEnvironment(process.env),
        },
      },
      () => undefined,
    );

  const start = async (port = 0): Promise<World> => {
    const kept = keptSessions();
    const terminals = new TerminalSessions(kept.spawner(loginShellSpawner()));
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
      kept,
      now: () => new Date('2026-11-23T07:14:00.000Z'),
      locateCli: async () => process.execPath,
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
          command: process.execPath,
          args: ['-e', LOOP],
          env: {},
          observation: 'hooks',
          version: 'fixture',
          directory,
          dispose: () => rm(directory, { recursive: true, force: true }),
        };
      },
    });
    const world = { runtime, terminals, mcp, kept };
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
        payload: { hook_event_name: name, session_id: 'native-provider-session', ...extra },
      }),
    });
    return response.status;
  };
  const row = async () => (await nativeTerminalRow(t.db, conversationId))!;
  const launched = async (world: World) => {
    await world.runtime.launch(conversationId, { prompt: 'Check the fixture', resume: false });
    const id = (await row()).id;
    await until(async () => (await world.kept.listSessionIds()).includes(id), 'the session');
    return id;
  };

  beforeEach(async () => {
    t = await createTestDb();
    folder = mkdtempSync(join(tmpdir(), 'spsh-db-'));
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
    await keptSessions().stopAll();
    await t.cleanup();
    await rm(folder, { recursive: true, force: true });
  });

  it('adopts a running session with its turn and hooks after a restart, then stops it', async () => {
    const first = await start();
    const id = await launched(first);
    expect(await hook('SessionStart')).toBe(204);
    expect(await hook('UserPromptSubmit', { prompt: 'Check the fixture', prompt_id: 'p1' })).toBe(
      204,
    );

    const second = await restart(first);

    expect(await second.kept.listSessionIds()).toEqual([id]);
    expect(await second.runtime.get(conversationId)).toMatchObject({
      state: 'unknown',
      readopted: { at: '2026-11-23T07:14:00.000Z', stepsComplete: false },
    });
    expect(await hook('Stop', { prompt_id: 'p1' })).toBe(204);
    expect((await row()).state).toBe('ready');

    await second.runtime.stop(conversationId);
    expect(await second.kept.listSessionIds()).toEqual([]);
    expect((await row()).state).toBe('exited');
  });

  it('records the real exit of a command that ended while Spark was down', async () => {
    const first = await start();
    const id = await launched(first);
    await first.runtime.detach();
    const paths = sessionHostPaths(join(folder, 'host'));
    await withHostConnection(paths, (host) =>
      host.request({ kind: 'write', session: id, data: 'quit\r' }),
    );
    await until(async () => {
      const listed = await withHostConnection(paths, (host) => host.request({ kind: 'list' }));
      return listedSchema.parse(listed).some((entry) => entry.exited);
    }, 'the command to end');
    const second = await start(first.mcp.port);
    await second.runtime.recover();
    await until(async () => (await row()).state === 'error', 'the exit to be recorded');
    expect((await row()).reason).toBe('Native agent exited (4).');
    expect(await second.kept.listSessionIds()).toEqual([]);
  });

  it('stops every session and the host when Spark quits', async () => {
    const world = await start();
    const id = await launched(world);
    expect(await world.kept.listSessionIds()).toEqual([id]);
    const listed = await withHostConnection(sessionHostPaths(join(folder, 'host')), (host) =>
      host.request({ kind: 'list' }),
    );
    const pid = listedSchema.parse(listed)[0]!.pid;
    await world.runtime.dispose();
    await world.kept.stopAll();
    expect(await world.kept.listSessionIds()).toEqual([]);
    expect((await row()).state).toBe('exited');
    await until(() => !isAlive(pid), 'the command to stop');
  });
});
