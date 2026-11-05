import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chatPortsResponseSchema } from '@spark-outpost/contracts';
import { createApp } from '../src/api/app.ts';
import { localClient, testAppOptions } from './app-support.ts';
import { pairDevice, remoteClient, turnRemoteOn } from './remote-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const CHAT = '00000000-0000-4000-8000-00000000000a';

let t: TestDb;
let ports: Record<string, number[]>;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  t = await createTestDb();
  ports = {};
  app = createApp({ ...testAppOptions(t), chatPorts: { ports: () => ports } });
});

afterEach(async () => {
  await t.cleanup();
});

describe('chat ports', () => {
  it('lists the ports each chat listens on for the Mac', async () => {
    const empty = await localClient(app).get('/api/chat-ports').expect(200);
    expect(chatPortsResponseSchema.parse(empty.body)).toEqual({ ports: {} });

    ports = { [CHAT]: [3000, 5173] };
    const listed = await localClient(app).get('/api/chat-ports').expect(200);
    expect(chatPortsResponseSchema.parse(listed.body)).toEqual({ ports: { [CHAT]: [3000, 5173] } });
  });

  it('answers empty without a watcher', async () => {
    const bare = createApp(testAppOptions(t));
    const listed = await localClient(bare).get('/api/chat-ports').expect(200);
    expect(listed.body).toEqual({ ports: {} });
  });

  it('refuses a paired device', async () => {
    ports = { [CHAT]: [5173] };
    await turnRemoteOn(app);
    const phone = remoteClient(app, (await pairDevice(app)).cookie);
    const refused = await phone.get('/api/chat-ports').expect(403);
    expect(JSON.stringify(refused.body)).not.toContain('5173');
  });
});
