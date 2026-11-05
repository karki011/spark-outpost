import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAppEvent, SPARK_ACTION_OPTION, type AppEvent } from '@spark-outpost/contracts';
import {
  ApprovalConflictError,
  ApprovalNotFoundError,
  decideApproval,
  getApproval,
  insertApproval,
} from '../src/persistence/approvals.ts';
import { listen } from '../src/persistence/notifications.ts';
import {
  abandonRunningSparkActions,
  claimSparkAction,
  finishSparkAction,
  retrySparkAction,
  WAITING_RESULT,
} from '../src/persistence/spark-results.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { OPEN_PR_RETIRED } from '../src/spark-mcp/actions/perform.ts';
import { RESTARTED_MESSAGE } from '../src/spark-mcp/actions/follow-through.ts';
import { saveConnection as saveTicketConnection } from '../src/tickets/connections.ts';
import { LINEAR_KEY } from './fake-linear.ts';
import {
  cardResult,
  pendingCard,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { createTestDb, eventually, startChat, testDatabaseUrl, type TestDb } from './support.ts';
import { startTicketStubs, type TicketStubs } from './ticket-support.ts';

let t: TestDb;
let secrets: SecretStore;
let stubs: TicketStubs;
let recorded: RecordedHooks;
let tools: SparkToolsHarness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  secrets = memorySecretStore();
  stubs = await startTicketStubs();
  await saveTicketConnection(
    { db: t.db, workspaceId: t.workspaceId, secrets, fetch, linearApiUrl: stubs.linearUrl },
    { source: 'linear', apiKey: LINEAR_KEY },
  );
  recorded = recordedHooks();
});

afterEach(async () => {
  recorded.stop();
  await tools?.close();
  tools = null;
  await stubs.close();
  await t.cleanup();
});

async function proposedTicket() {
  const { conversationId, runId } = await startChat(t, 'Look into the crash');
  tools = await startSparkTools(
    t,
    { conversationId, runId, actions: recorded.hooks },
    { secrets, linearApiUrl: stubs.linearUrl },
  );
  await tools.call('spark_create_ticket', { project: 'ENG', title: 'Crash on save' });
  return { conversationId, runId, card: await pendingCard(t) };
}

async function heldCard() {
  const { conversationId, runId } = await startChat(t, 'Look into the crash');
  const card = await insertApproval(
    t.db,
    {
      runId,
      toolCallId: 'spark:create_ticket:held',
      rpcId: null,
      kind: 'spark_action',
      title: 'Create this ticket? Crash on save',
      payload: {
        command: null,
        cwd: null,
        paths: [],
        diffs: [],
        truncated: false,
        sparkAction: {
          action: 'create_ticket',
          source: 'linear',
          project: 'ENG',
          title: 'Crash on save',
          description: '',
          type: null,
          priority: null,
          labels: [],
          assignToMe: false,
        },
        sparkResult: WAITING_RESULT,
      },
      options: [
        { optionId: SPARK_ACTION_OPTION.confirm, name: 'Create ticket', kind: 'allow_once' },
        { optionId: SPARK_ACTION_OPTION.decline, name: 'Don’t', kind: 'reject_once' },
      ],
      reason: null,
    },
    null,
  );
  return { conversationId, card };
}

const confirm = (id: string) =>
  decideApproval(t.db, t.workspaceId, id, {
    optionId: SPARK_ACTION_OPTION.confirm,
    scope: 'once',
  });

const crashTickets = () =>
  stubs.linear.issues.filter((issue) => issue.title === 'Crash on save').length;

const stateOf = async (id: string) => (await getApproval(t.db, id))?.payload.sparkResult?.state;

describe('a confirmed Spark action', { timeout: 60_000 }, () => {
  it('tells the open chat each time its result changes', async () => {
    const { conversationId, card } = await heldCard();
    const seen: AppEvent[] = [];
    const listener = await listen(testDatabaseUrl(), 'changes', (payload) => {
      const event = parseAppEvent(payload);
      if (event?.conversationId === conversationId) seen.push(event);
    });
    try {
      await confirm(card.id);
      await eventually(async () => seen.length > 0, 5_000);
      seen.length = 0;
      await claimSparkAction(t.db);
      await eventually(async () => seen.some((event) => event.kind === 'approval'), 5_000);
      seen.length = 0;
      await finishSparkAction(t.db, card.id, { state: 'failed', message: 'No.', url: null });
      await eventually(async () => seen.some((event) => event.kind === 'approval'), 5_000);
    } finally {
      await listener.close();
    }
  });

  it('is done once however many times the user clicks confirm', async () => {
    const { card } = await proposedTicket();
    const clicks = await Promise.allSettled([confirm(card.id), confirm(card.id), confirm(card.id)]);
    expect(clicks.filter((click) => click.status === 'fulfilled')).toHaveLength(1);
    for (const click of clicks) {
      if (click.status === 'rejected') expect(click.reason).toBeInstanceOf(ApprovalConflictError);
    }
    const settled = await cardResult(t, card.id);
    expect(settled.payload.sparkResult).toMatchObject({ state: 'done' });
    expect(crashTickets()).toBe(1);
  });

  it('is claimed by one worker only', async () => {
    const { card } = await heldCard();
    await confirm(card.id);
    const claims = await Promise.all([claimSparkAction(t.db), claimSparkAction(t.db)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await stateOf(card.id)).toBe('running');
  });

  it('runs again from Try again after it failed, and only while it is failed', async () => {
    const { card } = await proposedTicket();
    await expect(retrySparkAction(t.db, t.workspaceId, card.id)).rejects.toBeInstanceOf(
      ApprovalConflictError,
    );
    await confirm(card.id);
    await cardResult(t, card.id);
    await expect(retrySparkAction(t.db, t.workspaceId, card.id)).rejects.toBeInstanceOf(
      ApprovalConflictError,
    );
    await finishSparkAction(t.db, card.id, {
      state: 'failed',
      message: 'Linear said no.',
      url: null,
    });
    const retried = await retrySparkAction(t.db, t.workspaceId, card.id);
    expect(retried.payload.sparkResult?.state).toBe('waiting');
    const settled = await cardResult(t, card.id);
    expect(settled.payload.sparkResult).toMatchObject({ state: 'done' });
  });

  it('does not retry by itself after a failure', async () => {
    const { card } = await proposedTicket();
    await confirm(card.id);
    await cardResult(t, card.id);
    const before = crashTickets();
    await finishSparkAction(t.db, card.id, {
      state: 'failed',
      message: 'Linear said no.',
      url: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await stateOf(card.id)).toBe('failed');
    expect(crashTickets()).toBe(before);
  });

  it('reads outcome unknown after a restart mid-action and refuses a repeat that could do it twice', async () => {
    const { card } = await heldCard();
    await confirm(card.id);
    await claimSparkAction(t.db);
    expect(await abandonRunningSparkActions(t.db, RESTARTED_MESSAGE)).toBe(1);
    const lost = await getApproval(t.db, card.id);
    expect(lost?.payload.sparkResult).toMatchObject({
      state: 'unknown',
      message: RESTARTED_MESSAGE,
    });
    await expect(retrySparkAction(t.db, t.workspaceId, card.id)).rejects.toThrow(/twice/);
    expect(await claimSparkAction(t.db)).toBeNull();
  });

  it('retries a repeat-safe action whose outcome is unknown', async () => {
    const { card } = await heldCard();
    await t.db.query(
      `UPDATE approvals SET payload = jsonb_set(payload, '{sparkAction}', $2::jsonb) WHERE id = $1`,
      [
        card.id,
        JSON.stringify({
          action: 'read_page',
          origin: 'https://example.com',
          path: '/',
          title: 'Example',
          what: 'read',
        }),
      ],
    );
    await confirm(card.id);
    await claimSparkAction(t.db);
    await abandonRunningSparkActions(t.db, RESTARTED_MESSAGE);
    const retried = await retrySparkAction(t.db, t.workspaceId, card.id);
    expect(retried.payload.sparkResult?.state).toBe('waiting');
  });

  it('cannot be retried from another workspace or for an unknown card', async () => {
    const { card } = await heldCard();
    await expect(
      retrySparkAction(t.db, '7f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d', card.id),
    ).rejects.toBeInstanceOf(ApprovalNotFoundError);
  });

  it('fails an old open-pull-request card plainly instead of pushing', async () => {
    const { card } = await heldCard();
    await t.db.query(
      `UPDATE approvals SET payload = jsonb_set(payload, '{sparkAction}', $2::jsonb) WHERE id = $1`,
      [
        card.id,
        JSON.stringify({
          action: 'open_pr',
          taskId: '7f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
          title: 'Tidy notes',
          body: '',
          branch: 'spark/tidy-notes',
          base: 'main',
          repo: 'acme/widgets',
          files: [],
          moreFiles: 0,
        }),
      ],
    );
    tools = await startSparkTools(t, {}, { secrets, linearApiUrl: stubs.linearUrl });
    await confirm(card.id);
    const settled = await cardResult(t, card.id);
    expect(settled.payload.sparkResult).toMatchObject({
      state: 'failed',
      message: OPEN_PR_RETIRED,
    });
  });

  it('tells the agent the last confirmed attempt failed when it proposes the same action again', async () => {
    const { card } = await proposedTicket();
    await confirm(card.id);
    await cardResult(t, card.id);
    await finishSparkAction(t.db, card.id, {
      state: 'failed',
      message: 'Linear said no.',
      url: null,
    });
    const again = (
      await tools!.call('spark_create_ticket', { project: 'ENG', title: 'Crash on save' })
    ).json<{ outcome: string; lastAttempt?: string }>();
    expect(again.outcome).toBe('waiting_for_user');
    expect(again.lastAttempt).toContain('Linear said no.');
  });
});
