import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TerminalRemoteView } from '@spark-outpost/contracts';
import { createApp } from '../src/api/app.ts';
import type { NativeRuntime } from '../src/terminal/native-runtime.ts';
import { localClient, testAppOptions } from './app-support.ts';
import { pairDevice, remoteClient, setSwitches, turnRemoteOn } from './remote-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const CHAT = randomUUID();
const RUN = randomUUID();
const VIEW: TerminalRemoteView = {
  provider: 'claude',
  state: 'working',
  running: true,
  items: [],
  truncated: false,
  approval: null,
  approvalsHere: true,
};

let t: TestDb;
let app: ReturnType<typeof createApp>;
let calls: string[];

function fakeRuntime(): NativeRuntime {
  return {
    get: async () => ({ id: randomUUID(), conversationId: CHAT }),
    remote: {
      view: async () => VIEW,
      message: async (_id: string, text: string) => void calls.push(`message ${text}`),
      interrupt: async () => void calls.push('interrupt'),
      decide: async (_id: string, decision: { decision: string }) =>
        void calls.push(`decide ${decision.decision}`),
    },
    ownsRun: (runId: string) => runId === RUN,
    stopRun: async () => {
      calls.push('stopRun');
      return true;
    },
    stopAll: async () => undefined,
  } as unknown as NativeRuntime;
}

beforeEach(async () => {
  t = await createTestDb();
  calls = [];
  app = createApp({ ...testAppOptions(t), nativeTerminals: fakeRuntime() });
  await turnRemoteOn(app);
});

afterEach(async () => {
  await t.cleanup();
});

const routes = {
  status: ['get', `/api/conversations/${CHAT}/terminal`],
  view: ['get', `/api/conversations/${CHAT}/terminal/transcript`],
  message: ['post', `/api/conversations/${CHAT}/terminal/message`],
  interrupt: ['post', `/api/conversations/${CHAT}/terminal/interrupt`],
  approval: ['post', `/api/conversations/${CHAT}/terminal/approval`],
} as const;

async function call(phone: ReturnType<typeof remoteClient>, route: keyof typeof routes) {
  const [method, path] = routes[route];
  if (method === 'get') return phone.get(path);
  const body =
    route === 'message'
      ? { text: 'run the tests please' }
      : route === 'approval'
        ? { id: randomUUID(), decision: 'allow' }
        : {};
  return phone.send(method, path, body);
}

describe('a Terminal session from a paired device', () => {
  it('is refused while both switches are off, as they are by default', async () => {
    const phone = remoteClient(app, (await pairDevice(app)).cookie);
    for (const route of Object.keys(routes) as (keyof typeof routes)[]) {
      const response = await call(phone, route);
      expect([route, response.status]).toEqual([route, 403]);
      expect(response.body.error).toMatch(/^Turned off for remote control on your Mac: /);
    }
    expect(calls).toEqual([]);
  });

  it('follows, types and stops with the first switch, and approves only with the second', async () => {
    const phone = remoteClient(app, (await pairDevice(app)).cookie);
    await setSwitches(app, { terminal: true });
    expect((await call(phone, 'view')).body).toEqual(VIEW);
    expect((await call(phone, 'message')).status).toBe(204);
    expect((await call(phone, 'interrupt')).status).toBe(204);
    expect((await call(phone, 'approval')).status).toBe(403);
    await setSwitches(app, { terminalApprove: true });
    expect((await call(phone, 'approval')).status).toBe(204);
    expect(calls).toEqual(['message run the tests please', 'interrupt', 'decide allow']);
  });

  it('audits what the device did by path and never keeps the message text', async () => {
    const phone = remoteClient(app, (await pairDevice(app)).cookie);
    await setSwitches(app, { terminal: true });
    await call(phone, 'message');
    const { rows } = await t.db.query<{ path: string; row: string }>(
      `SELECT path, row_to_json(remote_audit)::text AS row FROM remote_audit WHERE action = 'request'`,
    );
    expect(rows.map((row) => row.path)).toContain(routes.message[1]);
    expect(rows.map((row) => row.row).join('\n')).not.toContain('run the tests please');
  });

  it('never lets a device end a Terminal session through a run cancel', async () => {
    const phone = remoteClient(app, (await pairDevice(app)).cookie);
    const refused = await phone.send('post', `/api/runs/${RUN}/cancel`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('Use Stop in the Terminal session to interrupt the agent.');
    expect(calls).toEqual([]);
    const local = await localClient(app).send('post', `/api/runs/${RUN}/cancel`);
    expect(local.status).not.toBe(409);
  });
});
