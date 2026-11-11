import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventType, type ActivityStep, type RunEvent } from '@spark-outpost/contracts';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import {
  createConversation,
  getConversationDetail,
  sendUserMessage,
} from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { STEP_DIFF_BUDGET } from '../src/workflow/step-diffs.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { storedEvents } from './agui-conformance.ts';
import { createTestApp } from './app-support.ts';
import { BIG_LINES, DIFF_API_KEY, DIFF_SECRET_VALUE } from './fake-acp-diffs.ts';
import { FAKE_ACP_LAUNCH } from './fake-acp-support.ts';
import { FAKE_AGENT_MODES } from './fake-agent-modes.ts';
import { pairDevice, remoteClient, turnRemoteOn } from './remote-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker | null = null;

beforeEach(async () => {
  t = await createTestDb();
  const provider = createAcpProvider({
    definition: { ...agentDefinitions.codex, name: 'Fake', ...FAKE_AGENT_MODES },
    launch: FAKE_ACP_LAUNCH,
  });
  worker = startWorker({
    db: t.db,
    providers: new Map([['codex', provider]]),
    leaseSeconds: 30,
    pollMs: 20,
    cancelPollMs: 20,
  });
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
});

async function editedChat() {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  const sent = await sendUserMessage(
    t.db,
    conversation.id,
    { id: randomUUID(), content: '#diffs' },
    { provider: 'codex' },
  );
  const run = await eventually(async () => {
    const found = await getRun(t.db, sent.run.id);
    return found?.finishedAt ? found : null;
  }, 20_000);
  expect(run.status).toBe('succeeded');
  return { conversationId: conversation.id, runId: sent.run.id };
}

const stepFor = (steps: readonly ActivityStep[] | undefined, path: string) =>
  steps?.find((step) => step.diffs?.some((diff) => diff.path.endsWith(path)));

describe('diffs on work log steps', () => {
  it('stores an edit diff on its step and returns it from the chat detail after a re-read', async () => {
    const { conversationId, runId } = await editedChat();
    const detail = await getConversationDetail(t.db, conversationId);
    const step = stepFor(detail?.activity[runId], 'notes.ts');

    expect(step).toMatchObject({ done: true, toolKind: 'edit' });
    expect(step?.diffs).toEqual([
      {
        path: '/work/app/src/notes.ts',
        added: 3,
        removed: 1,
        oldText: 'one\ntwo\n',
        newText: 'one\n2\nthree\nkey=[redacted:env]\n',
      },
    ]);
    expect(JSON.stringify(detail)).not.toContain(DIFF_API_KEY);
  });

  it('records only the path of a secret file and never stores its diff', async () => {
    const { conversationId, runId } = await editedChat();
    const detail = await getConversationDetail(t.db, conversationId);
    const step = stepFor(detail?.activity[runId], '.env');

    expect(step?.diffs).toEqual([{ path: '/work/app/.env', added: 0, removed: 0, withheld: true }]);
    const stored = JSON.stringify(await storedEvents(t.db, runId));
    expect(stored).not.toContain(DIFF_SECRET_VALUE);
    expect(stored).not.toContain('TOKEN=old');
  });

  it('cuts an oversized diff at the shared budget and flags it', async () => {
    const { conversationId, runId } = await editedChat();
    const detail = await getConversationDetail(t.db, conversationId);
    const [diff] = stepFor(detail?.activity[runId], 'big.ts')?.diffs ?? [];

    expect(diff).toMatchObject({ truncated: true, oldText: null, added: BIG_LINES, removed: 0 });
    expect(diff?.newText?.length).toBe(STEP_DIFF_BUDGET);
  });

  it('puts the diff on the finished step event of the live stream', async () => {
    const { runId } = await editedChat();
    const events = await storedEvents(t.db, runId);
    const finished = events.filter((event: RunEvent) => event.type === EventType.STEP_FINISHED) as {
      metadata?: { spark?: { diffs?: { path: string }[] } };
    }[];

    const withDiffs = finished.flatMap((event) => event.metadata?.spark?.diffs ?? []);
    expect(withDiffs.map((diff) => diff.path)).toEqual([
      '/work/app/src/notes.ts',
      '/work/app/.env',
      '/work/app/src/big.ts',
    ]);
  });

  it('gives a paired device the same stored diffs and still no secret file content', async () => {
    const { conversationId, runId } = await editedChat();
    const app = createTestApp(t);
    await turnRemoteOn(app);
    const device = await pairDevice(app, 'Pocket phone');
    const phone = remoteClient(app, device.cookie);

    const detail = await phone.get(`/api/conversations/${conversationId}`).expect(200);
    const steps = detail.body.activity[runId] as ActivityStep[];

    expect(stepFor(steps, 'notes.ts')?.diffs?.[0]?.newText).toContain('three');
    expect(stepFor(steps, '.env')?.diffs).toEqual([
      { path: '/work/app/.env', added: 0, removed: 0, withheld: true },
    ]);
    expect(JSON.stringify(detail.body)).not.toContain(DIFF_SECRET_VALUE);
  });
});
