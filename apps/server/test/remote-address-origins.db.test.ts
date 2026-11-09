import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertApproval } from '../src/persistence/approvals.ts';
import { insertRunEvent } from '../src/persistence/run-events.ts';
import { addressCard } from '../src/workflow/address-card.ts';
import { runEvents } from '../src/workflow/run-events.ts';
import { createTestApp, localClient } from './app-support.ts';
import { pairDevice, remoteClient, turnRemoteOn } from './remote-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
  await turnRemoteOn(app);
});

afterEach(async () => {
  await t.cleanup();
});

const SECRET = 'sk-live-4f9a8b7c6d5e';
const URL = `https://auth.example.com/authorize?client_id=docs&token=${SECRET}`;

async function waitingAddress() {
  const chat = await startChat(t, 'Sign in to the docs server');
  const card = await insertApproval(
    t.db,
    addressCard(
      chat.runId,
      {
        toolCallId: 'elicitation:1',
        rpcId: null,
        agent: 'Codex',
        url: URL,
        message: 'Authenticate with MCP server docs',
        secretFiles: ['.env'],
      },
      [],
    ),
  );
  await insertRunEvent(t.db as never, chat.runId, runEvents.approvalRequested(card));
  await t.db.query(`UPDATE runs SET status = 'succeeded', finished_at = now() WHERE id = $1`, [
    chat.runId,
  ]);
  return chat;
}

function holdsNoAddress(text: string) {
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain('/authorize');
  expect(text).not.toContain('client_id');
}

describe('an Open this address card read from a paired device', () => {
  it('shows only the address’s origin in the chat, its events and attention', async () => {
    const { conversationId, runId } = await waitingAddress();
    const phone = remoteClient(app, (await pairDevice(app)).cookie);

    const detail = await phone.get(`/api/conversations/${conversationId}`).expect(200);
    holdsNoAddress(JSON.stringify(detail.body));
    expect(JSON.stringify(detail.body)).toContain('"url":"https://auth.example.com"');

    const stream = await phone.get(`/api/run-events?runs=${runId}:0`).expect(200);
    expect(stream.text).toContain('Open this address?');
    holdsNoAddress(stream.text);

    for (const path of ['/api/conversations', '/api/attention']) {
      holdsNoAddress(JSON.stringify((await phone.get(path).expect(200)).body));
    }
  });

  it('keeps the whole address on the Mac, which opens it', async () => {
    const { conversationId } = await waitingAddress();
    const detail = await localClient(app).get(`/api/conversations/${conversationId}`).expect(200);
    expect(JSON.stringify(detail.body)).toContain(SECRET);
  });
});
