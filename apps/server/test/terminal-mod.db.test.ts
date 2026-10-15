import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.ts';
import { createConversation } from '../src/persistence/conversations.ts';
import { trackPull } from '../src/persistence/tracked-pulls.ts';
import { saveRemoteHostname, saveRemoteSwitches } from '../src/remote/store.ts';
import { nativeHookHost } from '../src/terminal/native-hook-host.ts';
import type { NativeRuntime } from '../src/terminal/native-runtime.ts';
import type { LiveSession } from '../src/terminal/native-runtime-types.ts';
import { reserveNativeTerminalLaunch } from '../src/persistence/native-terminal-turns.ts';
import { terminalApprovals } from '../src/terminal/remote/approvals.ts';
import { modInbox } from '../src/terminal/remote/mod-inbox.ts';
import { answerWaits } from '../src/terminal/remote/mod-routing.ts';
import { localClient, testAppOptions } from './app-support.ts';
import { pairDevice, remoteClient, setSwitches, turnRemoteOn } from './remote-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let chat: string;

beforeEach(async () => {
  t = await createTestDb();
  chat = randomUUID();
  await createConversation(t.db, t.workspaceId, chat, {
    sessionType: 'terminal',
    terminalProvider: 'claude',
  });
});

afterEach(async () => {
  await t.cleanup();
});

function session(): LiveSession {
  return { row: { conversation_id: chat, provider: 'claude' } } as unknown as LiveSession;
}

describe('the Claude mod inbox', () => {
  it('reads the approvals switch and the chat’s pull request for the status band', async () => {
    await saveRemoteHostname(t.db, t.workspaceId, 'mac.tail1234.ts.net');
    await saveRemoteSwitches(t.db, t.workspaceId, { terminal: true, terminalApprove: true });
    await trackPull(t.db, {
      workspaceId: t.workspaceId,
      conversationId: chat,
      taskId: null,
      host: 'github.com',
      owner: 'acme',
      repo: 'widgets',
      number: 42,
      url: 'https://github.com/acme/widgets/pull/42',
      branch: 'spark/notes',
      via: 'terminal',
      by: null,
      runId: null,
      outside: false,
      followUp: true,
    });
    await t.db.query(`UPDATE pr_watches SET checks = 'pending' WHERE conversation_id = $1`, [chat]);
    const mod = modInbox({
      db: t.db,
      workspaceId: t.workspaceId,
      waitsForAnswer: async () => false,
    });
    mod.followed(chat);
    expect(await mod.poll(session())).toEqual({
      messages: [],
      notices: [],
      status: 'Spark · phone connected · approvals on · PR #42 · checks running',
    });
  });

  it('carries a phone message from the hook host to the mod, unless the agent asks first', async () => {
    await reserveNativeTerminalLaunch(t.db, {
      id: randomUUID(),
      conversationId: chat,
      provider: 'claude',
      cwd: '/tmp',
      label: 'Session',
      runId: null,
      messageId: null,
      observation: 'hooks',
      reason: null,
      resume: false,
    });
    await t.db.query(
      `UPDATE native_terminal_sessions SET state = 'ready' WHERE conversation_id = $1`,
      [chat],
    );
    const mod = modInbox({
      db: t.db,
      workspaceId: t.workspaceId,
      waitsForAnswer: answerWaits(terminalApprovals(), t.db),
    });
    const host = await nativeHookHost(
      (token) => token === 'session-token',
      async () => true,
      async () => null,
      async () => mod.poll(session()),
    );
    const poll = async () => {
      const response = await fetch(new URL('/mod/inbox', host.url), {
        method: 'POST',
        headers: { Authorization: 'Bearer session-token', 'Content-Type': 'application/json' },
        body: '{}',
      });
      return (await response.json()) as { messages: string[] };
    };
    try {
      await poll();
      const sent = mod.send(chat, 'run the tests');
      expect((await poll()).messages).toEqual(['run the tests']);
      await expect(sent).resolves.toBe('taken');
      expect((await poll()).messages).toEqual([]);
      const late = mod.send(chat, 'then push');
      await t.db.query(
        `UPDATE native_terminal_sessions SET state = 'waiting_for_permission' WHERE conversation_id = $1`,
        [chat],
      );
      expect((await poll()).messages).toEqual([]);
      await expect(late).resolves.toBe('refused');
      await t.db.query(
        `UPDATE native_terminal_sessions SET state = 'ready' WHERE conversation_id = $1`,
        [chat],
      );
      expect((await poll()).messages).toEqual([]);
    } finally {
      await host.close();
    }
  });
});

describe('following a Terminal session from a paired device', () => {
  it('tells the runtime when the reader is a paired device', async () => {
    const reads: unknown[][] = [];
    const runtime = {
      remote: {
        view: async (...args: unknown[]) => {
          reads.push(args);
          return {
            provider: 'claude',
            state: 'ready',
            running: true,
            items: [],
            truncated: false,
            approval: null,
          };
        },
      },
      stopAll: async () => undefined,
    } as unknown as NativeRuntime;
    const app = createApp({ ...testAppOptions(t), nativeTerminals: runtime });
    await turnRemoteOn(app);
    await setSwitches(app, { terminal: true });
    const path = `/api/conversations/${chat}/terminal/transcript`;
    await localClient(app).get(path).expect(200);
    await remoteClient(app, (await pairDevice(app)).cookie)
      .get(path)
      .expect(200);
    expect(reads).toEqual([
      [chat, false],
      [chat, true],
    ]);
  });
});
