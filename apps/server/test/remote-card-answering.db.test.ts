import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FIXED_ON_MAC_REASON,
  REMOTE_CARD_ANSWERING_DEFAULT,
  STEP_UP_NEEDS_PASSKEY,
  STEP_UP_REQUIRED,
  kindOnMacReason,
  type AttentionList,
  type PasskeyRequestOptions,
} from '@spark-outpost/contracts';
import { insertApproval } from '../src/persistence/approvals.ts';
import { createTestApp, localClient } from './app-support.ts';
import { doRun } from './approval-support.ts';
import { assertPasskey, type SoftPasskey } from './passkey-authenticator.ts';
import { passkeyAudit, savePasskey } from './remote-passkey-support.ts';
import {
  REMOTE_ORIGIN,
  pairDevice,
  remoteClient,
  turnRemoteOn,
  type PairedDevice,
} from './remote-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;
let device: PairedDevice;
let phone: ReturnType<typeof remoteClient>;
let root: string;
let runId: string;
let conversationId: string;

const base = { command: null, cwd: null, paths: [], diffs: [], truncated: false };

const crewAction = {
  action: 'crew_edit',
  target: 'workflow',
  id: 'nightly',
  name: 'Nightly',
  files: [{ path: 'nightly.json', change: 'new', before: null, after: '{}\n', baseHash: null }],
  stages: [['Scout']],
  similar: [],
  agent: 'Claude',
  modeName: 'Manual',
};

const rulesAction = (target: 'user' | 'managed') => ({
  action: 'rules_edit',
  target,
  add: [{ effect: 'deny', rule: 'Push(force)' }],
  remove: [],
  fileHash: 'abc',
  agent: 'Claude',
  modeName: 'Manual',
  provider: 'claude',
  agentMode: 'default',
  sessionRow: null,
});

const deny = { optionId: 'decline', scope: 'once' };

function sparkCard(toolCallId: string, sparkAction: object) {
  return insertApproval(t.db, {
    runId,
    toolCallId,
    rpcId: null,
    kind: 'spark_action',
    title: 'card',
    payload: { ...base, sparkAction } as never,
    options: [
      { optionId: 'confirm', name: 'Allow', kind: 'allow_once' },
      { optionId: 'decline', name: 'Deny', kind: 'reject_once' },
    ],
    reason: null,
  });
}

const setAnswering = (change: object) =>
  localClient(app).send('patch', '/api/remote/card-answering', change).expect(200);

const decide = (client: Pick<ReturnType<typeof remoteClient>, 'send'>, id: string) =>
  client.send('post', `/api/approvals/${id}/decision`, deny);

async function answeredBy(id: string) {
  const { rows } = await t.db.query<{ id: string | null; name: string | null }>(
    'SELECT answered_device_id AS id, answered_device_name AS name FROM approvals WHERE id = $1',
    [id],
  );
  return rows[0];
}

async function stepUp(client: ReturnType<typeof remoteClient>, id: string, passkey: SoftPasskey) {
  const asked = await client.send('post', `/api/approvals/${id}/step-up/options`).expect(200);
  const options = asked.body as PasskeyRequestOptions;
  const assertion = assertPasskey(passkey, options, { origin: REMOTE_ORIGIN });
  return client.send('post', `/api/approvals/${id}/step-up`, assertion);
}

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-card-answering-')));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
  await turnRemoteOn(app);
  device = await pairDevice(app);
  phone = remoteClient(app, device.cookie);
  ({ runId, conversationId } = await doRun(t, root));
});

afterEach(async () => {
  await t.cleanup();
});

describe('cards can be answered from', () => {
  it('starts on the Mac only and is changed only on the Mac', async () => {
    const session = await phone.get('/api/remote/session').expect(200);
    expect(session.body.cardAnswering).toEqual(REMOTE_CARD_ANSWERING_DEFAULT);
    await phone.send('patch', '/api/remote/card-answering', { from: 'devices' }).expect(403);
    const saved = await setAnswering({ from: 'devices', macOnly: ['rules'] });
    expect(saved.body).toEqual({ from: 'devices', macOnly: ['rules'] });
    expect((await passkeyAudit(t, 'card_answering_changed')).length).toBe(1);
  });

  it('keeps a Spark and workflow card on the Mac by default and names why', async () => {
    const card = await sparkCard('crew-1', crewAction);
    const refused = await decide(phone, card.id).expect(403);
    expect(refused.body.error).toBe(kindOnMacReason('crew'));
    await phone.send('post', `/api/approvals/${card.id}/retry`).expect(403);
    await decide(localClient(app), card.id).expect(200);
    expect(await answeredBy(card.id)).toEqual({ id: null, name: null });
  });

  it('lets a device answer it once turned on, and records which device answered', async () => {
    await setAnswering({ from: 'devices' });
    const card = await sparkCard('crew-2', crewAction);
    await decide(phone, card.id).expect(200);
    expect(await answeredBy(card.id)).toEqual({ id: device.id, name: 'Test phone' });
    const lines = await localClient(app)
      .get(`/api/conversations/${conversationId}/audit/export.jsonl`)
      .expect(200);
    const cardLine = lines.text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string; answeredOn?: string; device?: object })
      .find((line) => line.type === 'card');
    expect(cardLine).toMatchObject({
      answeredOn: 'device',
      device: { id: device.id, name: 'Test phone' },
    });
  });

  it('keeps a kind on the Mac when its override says so', async () => {
    await setAnswering({ from: 'devices', macOnly: ['crew'] });
    const card = await sparkCard('crew-3', crewAction);
    expect((await decide(phone, card.id).expect(403)).body.error).toBe(kindOnMacReason('crew'));
  });

  it('keeps a change to the company rules file on the Mac whatever the setting', async () => {
    await setAnswering({ from: 'devices', macOnly: [] });
    await savePasskey(app, device);
    const card = await sparkCard('rules-managed', rulesAction('managed'));
    expect((await decide(phone, card.id).expect(403)).body.error).toBe(FIXED_ON_MAC_REASON);
  });
});

describe('passkey step-up', () => {
  beforeEach(async () => {
    await setAnswering({ from: 'devices', macOnly: [] });
  });

  it('keeps a rules card on the Mac for a device with no passkey', async () => {
    const card = await sparkCard('rules-1', rulesAction('user'));
    expect((await decide(phone, card.id).expect(403)).body.error).toBe(STEP_UP_NEEDS_PASSKEY);
  });

  it('answers a rules card after the device’s passkey confirms it, once', async () => {
    const passkey = await savePasskey(app, device);
    const card = await sparkCard('rules-2', rulesAction('user'));
    expect((await decide(phone, card.id).expect(403)).body.error).toBe(STEP_UP_REQUIRED);
    await phone.send('post', `/api/approvals/${card.id}/retry`).expect(403);
    await stepUp(phone, card.id, passkey).then((response) => expect(response.status).toBe(204));
    await decide(phone, card.id).expect(200);
    expect(await answeredBy(card.id)).toEqual({ id: device.id, name: 'Test phone' });
    expect((await passkeyAudit(t, 'card_step_up'))[0]?.device_id).toBe(device.id);

    const next = await sparkCard('rules-3', rulesAction('user'));
    expect((await decide(phone, next.id).expect(403)).body.error).toBe(STEP_UP_REQUIRED);
  });

  it('refuses another device’s passkey and a card that needs none', async () => {
    const other = await pairDevice(app, 'Tablet');
    const theirs = await savePasskey(app, other);
    await savePasskey(app, device);
    const card = await sparkCard('rules-4', rulesAction('user'));
    expect((await stepUp(phone, card.id, theirs)).status).toBe(403);
    expect((await passkeyAudit(t, 'card_step_up_failed'))[0]?.detail).toEqual({
      reason: 'wrong_device',
    });
    await decide(phone, card.id).expect(403);
    const plain = await sparkCard('crew-4', crewAction);
    await phone.send('post', `/api/approvals/${plain.id}/step-up/options`).expect(409);
  });

  it('is not offered on the Mac itself', async () => {
    const card = await sparkCard('rules-5', rulesAction('user'));
    await localClient(app).send('post', `/api/approvals/${card.id}/step-up/options`).expect(404);
  });
});

describe('the Mac still sees what it must answer', () => {
  it('a device reading the chat leaves a card it cannot answer unread', async () => {
    const card = await sparkCard('crew-5', crewAction);
    await phone.send('post', `/api/attention/chats/${conversationId}/read`).expect(204);
    await phone.send('post', `/api/attention/approval:${card.id}/read`).expect(204);
    const { items } = (await localClient(app).get('/api/attention').expect(200))
      .body as AttentionList;
    expect(items.find((item) => item.key === `approval:${card.id}`)?.readAt).toBeNull();

    await localClient(app).send('post', `/api/attention/chats/${conversationId}/read`).expect(204);
    const after = (await localClient(app).get('/api/attention').expect(200)).body as AttentionList;
    expect(after.items.find((item) => item.key === `approval:${card.id}`)?.readAt).not.toBeNull();
  });
});
