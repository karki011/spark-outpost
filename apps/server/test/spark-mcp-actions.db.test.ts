import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SPARK_ACTION_OPTION, type Approval } from '@spark-outpost/contracts';
import { decideApproval, getApproval } from '../src/persistence/approvals.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { saveConnection as saveTicketConnection } from '../src/tickets/connections.ts';
import { JIRA_EMAIL, JIRA_TOKEN } from './fake-jira.ts';
import { LINEAR_KEY } from './fake-linear.ts';
import {
  answerCard,
  cardResult,
  confirmCard,
  pendingCard,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { createTestDb, eventually, startChat, type TestDb } from './support.ts';
import { startTicketStubs, type TicketStubs } from './ticket-support.ts';

let t: TestDb;
let secrets: SecretStore;
let stubs: TicketStubs;
let recorded: RecordedHooks;
let tools: SparkToolsHarness;

const ticketDeps = () => ({
  db: t.db,
  workspaceId: t.workspaceId,
  secrets,
  fetch,
  linearApiUrl: stubs.linearUrl,
});

beforeEach(async () => {
  t = await createTestDb();
  secrets = memorySecretStore();
  stubs = await startTicketStubs();
  await saveTicketConnection(ticketDeps(), { source: 'linear', apiKey: LINEAR_KEY });
  const { conversationId, runId } = await startChat(t, 'Plan the week');
  recorded = recordedHooks();
  tools = await startSparkTools(
    t,
    { conversationId, runId, actions: recorded.hooks },
    { secrets, linearApiUrl: stubs.linearUrl },
  );
});

afterEach(async () => {
  recorded.stop();
  await tools.close();
  await stubs.close();
  await t.cleanup();
});

async function events(action: string) {
  const { rows } = await t.db.query<{ outcome: string; ticket_key: string | null }>(
    'SELECT outcome, ticket_key FROM ticket_events WHERE action = $1 ORDER BY at',
    [action],
  );
  return rows;
}

const newest = () => stubs.linear.issues.at(-1)!;

describe('spark_create_ticket', () => {
  it('shows a card, creates the ticket with the user’s edits once confirmed, and audits it', async () => {
    const waiting = await tools.call('spark_create_ticket', {
      project: 'ENG',
      title: 'Crash on save',
      description: 'Steps to reproduce',
      priority: 'high',
      labels: ['bug', 'unknown-label'],
      assignToMe: true,
    });
    const card = await confirmCard(t, {
      edits: { title: 'Crash when saving drafts', priority: 'urgent' },
    });

    expect(card).toMatchObject({
      kind: 'spark_action',
      title: 'Create this ticket? Crash on save',
    });
    expect(card.options.map((option) => option.kind)).toEqual(['allow_once', 'reject_once']);
    expect(card.payload.sparkAction).toMatchObject({ action: 'create_ticket', source: 'linear' });
    expect(waiting.json()).toMatchObject({ outcome: 'waiting_for_user', approvalId: card.id });
    expect(card.payload.sparkResult).toMatchObject({
      state: 'done',
      message: 'Created ENG-105.',
      output: { key: 'ENG-105', labelsNotFound: ['unknown-label'] },
    });
    expect(newest()).toMatchObject({
      title: 'Crash when saving drafts',
      priority: 1,
      labels: ['bug'],
      assigneeId: 'user-1',
    });
    expect(await events('create')).toEqual([{ outcome: 'succeeded', ticket_key: 'ENG-105' }]);
    expect(recorded.events.map((event) => ('name' in event ? event.name : event.type))).toEqual([
      'approval_requested',
    ]);
    expect(JSON.stringify(recorded.audited)).toContain('spark/create_ticket');
    expect(JSON.stringify(recorded.audited)).not.toContain(LINEAR_KEY);
  });

  it('creates nothing when the user declines', async () => {
    const before = stubs.linear.issues.length;
    await tools.call('spark_create_ticket', { project: 'ENG', title: 'Not this one' });
    const card = await answerCard(t, SPARK_ACTION_OPTION.decline, { note: 'Too vague' });
    const settled = await cardResult(t, card.id);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(settled).toMatchObject({ status: 'denied', note: 'Too vague' });
    expect((await getApproval(t.db, card.id))?.payload.sparkResult?.state).toBe('waiting');
    expect(stubs.linear.issues).toHaveLength(before);
    expect(await events('create')).toEqual([]);
  });

  it('creates a Jira issue when Jira is the source', async () => {
    await saveTicketConnection(ticketDeps(), {
      source: 'jira',
      siteUrl: stubs.jiraUrl,
      email: JIRA_EMAIL,
      apiToken: JIRA_TOKEN,
    });
    const project = stubs.jira.issues[0]!.key.split('-')[0]!;
    await tools.call('spark_create_ticket', {
      source: 'jira',
      project,
      title: 'Jira thing',
      type: 'Bug',
    });
    const result = (await confirmCard(t)).payload.sparkResult!;
    const key = result.output?.key as string;

    expect(result.url).toBe(`${stubs.jiraUrl}/browse/${key}`);
    expect(stubs.jira.issues.at(-1)).toMatchObject({ key, summary: 'Jira thing' });
  });

  it('asks which source when both are connected and none is named', async () => {
    await saveTicketConnection(ticketDeps(), {
      source: 'jira',
      siteUrl: stubs.jiraUrl,
      email: JIRA_EMAIL,
      apiToken: JIRA_TOKEN,
    });
    const result = await tools.call('spark_create_ticket', { project: 'ENG', title: 'x' });
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining('pass source') });
  });
});

describe('ticket changes', () => {
  it('comments with the edited text once confirmed', async () => {
    await tools.call('spark_comment_ticket', { key: 'ENG-12', body: 'Draft' });
    const card = await confirmCard(t, { edits: { body: 'Fixed in #4' } });

    expect(card.payload.sparkAction).toMatchObject({
      action: 'comment_ticket',
      ticket: { key: 'ENG-12', title: 'Date divider shows Today twice' },
    });
    expect(
      stubs.linear.issues.find((item) => item.identifier === 'ENG-12')!.comments.at(-1),
    ).toMatchObject({ body: 'Fixed in #4' });
  });

  it('moves a ticket after confirmation and says when it is already there', async () => {
    await tools.call('spark_transition_ticket', { key: 'ENG-12', status: 'in_progress' });
    const card = await confirmCard(t);
    const again = (
      await tools.call('spark_transition_ticket', {
        key: 'ENG-12',
        status: 'in_progress',
      })
    ).json();

    expect(card.payload.sparkAction).toMatchObject({ from: 'Todo', status: 'in_progress' });
    expect(card.payload.sparkResult).toMatchObject({ state: 'done', output: { moved: true } });
    expect(again).toMatchObject({ outcome: 'unchanged' });
  });

  it('names the current owner on the card before taking someone else’s ticket', async () => {
    await tools.call('spark_assign_ticket', { key: 'ENG-15', to: 'me' });
    const card = await confirmCard(t);

    expect(card.payload.sparkAction).toMatchObject({ currentAssignee: 'Jordan Lee', to: 'me' });
    expect(card.payload.sparkResult).toMatchObject({
      state: 'done',
      output: { assignedTo: 'Alex Example' },
    });
  });
});

describe('the confirmation card', () => {
  it('refuses edits to fields that are not editable and wider scopes', async () => {
    await tools.call('spark_comment_ticket', { key: 'ENG-12', body: 'Hello' });
    const card: Approval = await pendingCard(t);
    const decide = (decision: Parameters<typeof decideApproval>[3]) =>
      decideApproval(t.db, t.workspaceId, card.id, decision);

    await expect(
      decide({ optionId: SPARK_ACTION_OPTION.confirm, scope: 'once', edits: { title: 'x' } }),
    ).rejects.toThrow('Check the edited fields');
    await expect(
      decide({ optionId: SPARK_ACTION_OPTION.confirm, scope: 'project' }),
    ).rejects.toThrow('Only commands');
    await expect(
      decide({ optionId: SPARK_ACTION_OPTION.decline, scope: 'once', edits: { body: 'y' } }),
    ).rejects.toThrow('only when you confirm');
    expect((await getApproval(t.db, card.id))?.status).toBe('pending');
    expect(stubs.linear.issues.find((item) => item.identifier === 'ENG-12')!.comments).toEqual([
      expect.objectContaining({ body: 'Seen on Safari too.' }),
    ]);
  });

  it('returns at once and still does it when the user confirms after the run ended', async () => {
    const started = Date.now();
    const waiting = (
      await tools.call('spark_comment_ticket', { key: 'ENG-12', body: 'Later' })
    ).json();
    const returnedIn = Date.now() - started;
    recorded.stop();
    const card = await pendingCard(t);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await getApproval(t.db, card.id))?.status).toBe('pending');

    const settled = await confirmCard(t);

    expect(waiting).toMatchObject({ outcome: 'waiting_for_user' });
    expect(returnedIn).toBeLessThan(10_000);
    expect(settled.payload.sparkResult).toMatchObject({
      state: 'done',
      message: 'Commented on ENG-12.',
    });
    await eventually(async () =>
      stubs.linear.issues
        .find((item) => item.identifier === 'ENG-12')!
        .comments.some((comment) => comment.body === 'Later'),
    );
  });

  it('refuses actions in a session that cannot show a card', async () => {
    const plain = await startSparkTools(t, {}, { secrets, linearApiUrl: stubs.linearUrl });
    const result = await plain.call('spark_comment_ticket', { key: 'ENG-12', body: 'x' });
    await plain.close();
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining('cannot ask') });
  });
});
