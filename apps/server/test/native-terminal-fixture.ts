import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { createConversation } from '../src/persistence/conversations.ts';
import { EVERYTHING_AVAILABLE } from '../src/spark-mcp/availability.ts';
import { startSparkMcpHost } from '../src/spark-mcp/host.ts';
import type { NativeLaunch, NativeLaunchInput } from '../src/terminal/native-launch.ts';
import { createNativeRuntime, type NativeRuntimeDeps } from '../src/terminal/native-runtime.ts';
import type { WatchTranscript } from '../src/terminal/native-tail.ts';
import type { PtyOptions, PtyProcess } from '../src/terminal/pty.ts';
import { defaultLimits, TerminalSessions } from '../src/terminal/sessions.ts';
import { toolDeps } from './spark-mcp-support.ts';
import { createTestDb } from './support.ts';

interface FixtureWatcher {
  path: string;
  from: number | null;
  position: number | null;
  atFlush: unknown[];
  close: ReturnType<typeof vi.fn<() => void>>;
  lines(records: unknown[]): Promise<void>;
  interrupt(promptId: string): Promise<void>;
}

const interruptRecord = (promptId: string) => ({
  type: 'user',
  isSidechain: false,
  promptId,
  message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] },
});

export async function nativeRuntimeFixture(
  options: { maxShells?: number; provider?: 'claude' | 'codex'; realFiles?: boolean } = {},
) {
  const provider = options.provider ?? 'claude';
  const agentMode = provider === 'claude' ? 'default' : 'agent';
  const t = await createTestDb();
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'spark-native-lifecycle-')));
  const conversationId = randomUUID();
  await createConversation(t.db, t.workspaceId, conversationId, {
    sessionType: 'terminal',
    terminalProvider: provider,
    title: 'Native fixture',
  });
  await t.db.query(`UPDATE conversations SET overrides = $2::jsonb WHERE id = $1`, [
    conversationId,
    JSON.stringify({ [provider]: { agentMode, level: 'hands-off' } }),
  ]);
  const inputs: NativeLaunchInput[] = [];
  const exits: ((exit: { exitCode: number }) => void)[] = [];
  const spawn = vi.fn((_options: PtyOptions): PtyProcess => ({
    pid: 999_999_999,
    write: vi.fn(),
    resize: vi.fn(),
    onData: () => undefined,
    onExit: (listener) => {
      exits.push(listener);
    },
  }));
  const terminals = new TerminalSessions(spawn, {
    ...defaultLimits,
    maxShells: options.maxShells ?? defaultLimits.maxShells,
  });
  const host = await startSparkMcpHost(toolDeps(t), async () => ({
    ...EVERYTHING_AVAILABLE,
    browser: false,
  }));
  const place: NonNullable<NativeRuntimeDeps['place']> = async (_deps, input) => ({
    input: { ...input, projectRoots: [folder] },
    repoRoot: folder,
    note: null,
  });
  const watchers: FixtureWatcher[] = [];
  const fixture = {
    t,
    watchers,
    conversationId,
    inputs,
    exits,
    startLines: [] as string[],
    spawn,
    terminals,
    observation: 'hooks' as NativeLaunch['observation'],
    place,
  };
  const prepare: NonNullable<NativeRuntimeDeps['prepareLaunch']> = async (input) => {
    inputs.push(input);
    return {
      command: '/fixture/claude',
      args: ['--', input.prompt],
      env: {},
      observation: fixture.observation,
      version: '2.1.280',
      dispose: async () => undefined,
    };
  };
  const fakeWatcher: WatchTranscript = (path, from, onLines) => {
    const watcher: FixtureWatcher = {
      path,
      from,
      position: null,
      atFlush: [],
      close: vi.fn<() => void>(),
      lines: (records) => onLines(records.map((record) => JSON.stringify(record))),
      interrupt: (promptId) => watcher.lines([interruptRecord(promptId)]),
    };
    watchers.push(watcher);
    return {
      ready: Promise.resolve(),
      flush: async () => {
        if (watcher.atFlush.length > 0) void watcher.lines(watcher.atFlush.splice(0));
      },
      offset: () => watcher.position,
      close: watcher.close,
    };
  };
  const deps: NativeRuntimeDeps = {
    db: t.db,
    workspaceId: t.workspaceId,
    terminals,
    dataDir: folder,
    channel: 'test',
    mcp: host,
    locateCli: async () => `/fixture/${provider}`,
    place: (...args) => fixture.place(...args),
    prepareLaunch: prepare,
    logStart: (line) => fixture.startLines.push(line),
    ...(options.realFiles ? {} : { watchTranscript: fakeWatcher }),
  };
  const runtime = await createNativeRuntime(deps);
  return Object.assign(fixture, {
    runtime,
    launch: () =>
      runtime.launch(conversationId, { prompt: 'Check the native fixture', resume: false }),
    async hook(name: string, extra: Record<string, unknown> = {}) {
      const input = inputs.at(-1)!;
      const response = await fetch(input.hooks.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${input.hooks.token}`,
        },
        body: JSON.stringify({
          sessionId: input.sessionId,
          provider,
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
    },
    async restart() {
      await this.runtime.dispose();
      this.runtime = await createNativeRuntime(deps);
      await this.runtime.recover();
    },
    async cleanup() {
      await this.runtime.dispose();
      terminals.killAll();
      await host.close();
      await t.cleanup();
      await rm(folder, { recursive: true, force: true });
    },
  });
}

export type NativeRuntimeFixture = Awaited<ReturnType<typeof nativeRuntimeFixture>>;
