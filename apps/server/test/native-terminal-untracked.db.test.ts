import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversation } from '../src/persistence/conversations.ts';
import { nativeTerminalRow } from '../src/persistence/native-terminals.ts';
import type { SparkMcpHost } from '../src/spark-mcp/host.ts';
import { createNativeRuntime, type NativeRuntime } from '../src/terminal/native-runtime.ts';
import type { PtyOptions, PtyProcess } from '../src/terminal/pty.ts';
import { loginShellSpawner } from '../src/terminal/pty.ts';
import { TerminalSessions } from '../src/terminal/sessions.ts';
import { chooseTmux, killTmuxServer, type TmuxHost } from '../src/terminal/tmux/tmux-host.ts';
import { tmuxSpawner } from '../src/terminal/tmux/tmux-spawner.ts';
import { readPane } from '../src/terminal/tmux/tmux-session.ts';
import { UNTRACKED_REASON } from '../src/terminal/untracked-launch.ts';
import { createTestDb, type TestDb } from './support.ts';

const built = resolve(import.meta.dirname, '../../..', '.local/tmux', process.arch, 'bin/tmux');
const bin = process.env.SPARK_TMUX_BIN || (existsSync(built) ? built : null);

function fakeMcp(): SparkMcpHost & { grant: ReturnType<typeof vi.fn> } {
  return {
    port: 0,
    browser: false,
    grant: vi.fn(async () => ({ url: '', token: '', revoke: () => undefined })),
    restore: vi.fn(async () => ({ url: '', token: '', revoke: () => undefined })),
  } as unknown as SparkMcpHost & { grant: ReturnType<typeof vi.fn> };
}

async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

async function terminalChat(t: TestDb, provider: 'gemini' | 'opencode' | 'amp') {
  const id = randomUUID();
  await createConversation(t.db, t.workspaceId, id, {
    sessionType: 'terminal',
    terminalProvider: provider,
    title: 'Untracked fixture',
  });
  return id;
}

async function runCount(t: TestDb, conversationId: string): Promise<number> {
  const { rows } = await t.db.query<{ count: string }>(
    'SELECT count(*) FROM runs WHERE conversation_id = $1',
    [conversationId],
  );
  return Number(rows[0]!.count);
}

describe('an untracked Terminal session', () => {
  let t: TestDb;
  let folder: string;
  let runtime: NativeRuntime;
  let terminals: TerminalSessions;
  let mcp: ReturnType<typeof fakeMcp>;
  let spawned: PtyOptions[];
  let exits: ((exit: { exitCode: number }) => void)[];
  let located: string[];
  let writes: string[];

  beforeEach(async () => {
    t = await createTestDb();
    folder = await realpath(await mkdtemp(join(tmpdir(), 'spark-untracked-')));
    spawned = [];
    exits = [];
    located = [];
    writes = [];
    terminals = new TerminalSessions((options: PtyOptions): PtyProcess => {
      spawned.push(options);
      return {
        pid: 999_999_998,
        write: (data: string) => writes.push(data),
        resize: () => undefined,
        onData: () => undefined,
        onExit: (listener) => {
          exits.push(listener);
        },
      };
    });
    mcp = fakeMcp();
    runtime = await createNativeRuntime({
      db: t.db,
      workspaceId: t.workspaceId,
      terminals,
      dataDir: folder,
      channel: 'test',
      mcp,
      locateCli: async (cli) => {
        located.push(cli);
        return cli === 'amp' ? null : `/fixture/bin/${cli}`;
      },
      prepareLaunch: async () => {
        throw new Error('An untracked session must not prepare a tracked launch.');
      },
    });
  });

  afterEach(async () => {
    await runtime?.dispose();
    terminals?.killAll();
    await t?.cleanup();
    await rm(folder, { recursive: true, force: true });
  });

  it('starts the CLI with no arguments and records only that it runs', async () => {
    const conversationId = await terminalChat(t, 'gemini');

    const launched = await runtime.launch(conversationId, { resume: false });

    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({ command: '/fixture/bin/gemini', args: [] });
    expect(spawned[0]!.cwd).toBe(join(folder, 'test', 'terminal-workspaces', conversationId));
    expect(launched.session).toMatchObject({
      provider: 'gemini',
      state: 'unknown',
      observation: 'unsupported',
      reason: UNTRACKED_REASON,
      runId: null,
      resumeAvailable: false,
    });
    expect(mcp.grant).not.toHaveBeenCalled();
    expect(await runCount(t, conversationId)).toBe(0);
    expect(Object.keys(spawned[0]!.env ?? {}).filter((key) => key.startsWith('SPARK_'))).toEqual(
      [],
    );
  });

  it('records the exit and starts again without a first message', async () => {
    const conversationId = await terminalChat(t, 'opencode');
    await runtime.launch(conversationId, { resume: false });

    exits[0]!({ exitCode: 0 });
    await until(
      async () => (await nativeTerminalRow(t.db, conversationId))?.state === 'exited',
      'the exit',
    );
    await runtime.launch(conversationId, { resume: false });

    expect(spawned).toHaveLength(2);
    expect((await nativeTerminalRow(t.db, conversationId))?.state).toBe('unknown');
    expect(await runCount(t, conversationId)).toBe(0);
  });

  it('stops like any Terminal session', async () => {
    const conversationId = await terminalChat(t, 'gemini');
    await runtime.launch(conversationId, { resume: false });

    await runtime.stop(conversationId);

    expect(await nativeTerminalRow(t.db, conversationId)).toMatchObject({ state: 'exited' });
    expect(await runCount(t, conversationId)).toBe(0);
  });

  it('refuses a first message, since the CLI starts without one', async () => {
    const conversationId = await terminalChat(t, 'gemini');

    await expect(
      runtime.launch(conversationId, { prompt: 'Fix the tests', resume: false }),
    ).rejects.toThrow('Gemini CLI starts without a first message');
    expect(spawned).toHaveLength(0);
    expect(await runCount(t, conversationId)).toBe(0);
  });

  it('says to install a CLI that is not on the PATH', async () => {
    const conversationId = await terminalChat(t, 'amp');

    await expect(runtime.launch(conversationId, { resume: false })).rejects.toThrow(
      'Install Amp before opening its terminal.',
    );
    expect(spawned).toHaveLength(0);
  });

  it('refuses messages, stops and approvals from a paired device', async () => {
    const conversationId = await terminalChat(t, 'gemini');
    await runtime.launch(conversationId, { resume: false });
    const refusal = 'Spark doesn’t follow Gemini CLI sessions. Use it on your Mac.';

    await expect(runtime.remote.message(conversationId, 'hello')).rejects.toThrow(refusal);
    await expect(runtime.remote.interrupt(conversationId)).rejects.toThrow(refusal);
    await expect(
      runtime.remote.decide(conversationId, { id: randomUUID(), decision: 'allow' }),
    ).rejects.toThrow(refusal);
    expect(writes).toEqual([]);
    expect(await runtime.remote.view(conversationId)).toMatchObject({
      provider: 'gemini',
      running: true,
      items: [],
      approval: null,
    });
  });

  it('lists which Terminal agents are installed', async () => {
    expect(await runtime.agents()).toEqual([
      { id: 'claude', name: 'Claude Code', installed: true },
      { id: 'codex', name: 'Codex', installed: true },
      { id: 'gemini', name: 'Gemini CLI', installed: true },
      { id: 'opencode', name: 'OpenCode', installed: true },
      { id: 'amp', name: 'Amp', installed: false },
    ]);
    expect(located).toEqual(['claude', 'codex', 'gemini', 'opencode', 'amp']);
  });
});

describe.skipIf(!bin)('an untracked Terminal session across a Spark restart', () => {
  let t: TestDb;
  let folder: string;
  let tmux: TmuxHost;
  const worlds: { runtime: NativeRuntime; terminals: TerminalSessions }[] = [];

  const start = async (cli: string) => {
    const terminals = new TerminalSessions(tmuxSpawner(loginShellSpawner(), tmux));
    const runtime = await createNativeRuntime({
      db: t.db,
      workspaceId: t.workspaceId,
      terminals,
      dataDir: folder,
      channel: 'test',
      mcp: fakeMcp(),
      tmux,
      now: () => new Date('2026-11-05T09:00:00.000Z'),
      locateCli: async () => cli,
    });
    worlds.push({ runtime, terminals });
    return runtime;
  };

  beforeEach(async () => {
    t = await createTestDb();
    folder = mkdtempSync(join(tmpdir(), 'sptu-db-'));
    const choice = chooseTmux({ ...process.env, SPARK_TMUX_BIN: bin! }, join(folder, 'tmux'), null);
    if (!choice.host) throw new Error(choice.reason);
    tmux = choice.host;
  });

  afterEach(async () => {
    for (const world of worlds.splice(0)) {
      await world.runtime.dispose().catch(() => undefined);
      world.terminals.killAll();
    }
    killTmuxServer(tmux);
    await t.cleanup();
    await rm(folder, { recursive: true, force: true });
  });

  it('keeps running and is adopted again with nothing more recorded', async () => {
    const cli = join(folder, 'gemini');
    await writeFile(cli, '#!/bin/sh\necho started\nwhile IFS= read -r line; do :; done\n');
    await chmod(cli, 0o755);
    const conversationId = await terminalChat(t, 'gemini');
    const first = await start(cli);
    await first.launch(conversationId, { resume: false });
    const id = (await nativeTerminalRow(t.db, conversationId))!.id;
    await until(() => readPane(tmux, id)?.dead === false, 'the session');
    const pid = readPane(tmux, id)!.pid;

    await first.detach();
    worlds.shift();
    const second = await start(cli);
    await second.recover();

    expect(readPane(tmux, id)?.pid).toBe(pid);
    expect(await second.get(conversationId)).toMatchObject({
      provider: 'gemini',
      state: 'unknown',
      readopted: { at: '2026-11-05T09:00:00.000Z' },
    });
    expect(await runCount(t, conversationId)).toBe(0);
    await second.stop(conversationId);
    expect((await nativeTerminalRow(t.db, conversationId))?.state).toBe('exited');
  });
});
