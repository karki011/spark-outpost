import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertApproval } from '../src/persistence/approvals.ts';
import { saveSlackChatThread } from '../src/persistence/slack.ts';
import { changeSlackSettings, slackStatus } from '../src/slack/connection.ts';
import { startSlackNotifier, type SlackNotifier } from '../src/slack/notifier.ts';
import { SLACK_ME } from './fake-slack.ts';
import {
  connectSlack,
  databaseText,
  slackDeps,
  startSlackStub,
  type SlackStub,
} from './slack-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;
let stub: SlackStub;
let deps: ReturnType<typeof slackDeps>;
let notifier: SlackNotifier;
let chat: { conversationId: string; runId: string };

const SINCE = new Date(Date.now() - 60_000);

beforeEach(async () => {
  t = await createTestDb();
  stub = await startSlackStub();
  deps = slackDeps(t, stub);
  await connectSlack(deps);
  notifier = startSlackNotifier(deps, { since: SINCE });
  chat = await startChat(t, 'Fix the upload retry <!channel>');
});

afterEach(async () => {
  await notifier.stop();
  await stub.close();
  await t.cleanup();
});

async function ask(kind: 'execute' | 'plan' | 'clarify', title: string) {
  return insertApproval(t.db, {
    runId: chat.runId,
    toolCallId: `tool-${randomUUID()}`,
    rpcId: null,
    kind,
    title,
    payload: { command: 'rm -rf build', cwd: null, paths: [], diffs: [], truncated: false },
    options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
    reason: null,
  });
}

async function finish(status: 'succeeded' | 'failed') {
  await t.db.query('UPDATE runs SET status = $2, finished_at = now() WHERE id = $1', [
    chat.runId,
    status,
  ]);
}

async function openPr(url = 'https://github.com/acme/web/pull/128') {
  const taskId = randomUUID();
  await t.db.query('INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, $3)', [
    taskId,
    chat.conversationId,
    'Upload retry',
  ]);
  await t.db.query(
    `INSERT INTO pr_watches (id, workspace_id, conversation_id, task_id, host, owner, repo, number, url, branch)
     VALUES ($1, $2, $3, $4, 'github.com', 'acme', 'web', 128, $5, 'spark/upload-retry')`,
    [randomUUID(), t.workspaceId, chat.conversationId, taskId, url],
  );
}

async function changed(kind: 'approval' | 'run' | 'conversation' | 'pull_request' = 'run') {
  notifier.changed({ kind, conversationId: chat.conversationId, runId: chat.runId });
  await notifier.settled();
}

async function deliveries() {
  const { rows } = await t.db.query<{ kind: string; outcome: string; reason: string | null }>(
    'SELECT kind, outcome, reason FROM slack_deliveries ORDER BY created_at, kind',
  );
  return rows;
}

describe('Slack notifications', () => {
  it('messages the user once per event with the title and a link, never the command', async () => {
    await ask('execute', 'Run rm -rf build');
    await changed('approval');
    await changed('approval');

    expect(stub.slack.posted).toHaveLength(1);
    const [message] = stub.slack.posted;
    expect(message!.channel).toBe(SLACK_ME);
    expect(message!.text).toContain('*Fix the upload retry &lt;!channel&gt;*');
    expect(message!.text).toContain('• Needs your approval');
    expect(message!.text).toContain(`<spark-outpost://chat/${chat.conversationId}|Open in Spark>`);
    expect(message!.text).not.toContain('rm -rf');
    expect(await deliveries()).toEqual([{ kind: 'needs_you', outcome: 'sent', reason: null }]);
  });

  it('names each kind of event in plain words', async () => {
    await ask('plan', 'Plan: rewrite the uploader');
    await ask('clarify', 'Which bucket?');
    await finish('failed');
    await openPr();
    await changed();

    expect(stub.slack.posted).toHaveLength(1);
    const lines = stub.slack.posted[0]!.text.split('\n');
    expect(lines).toEqual(
      expect.arrayContaining([
        '• Has a plan for you to review',
        '• Has a question for you',
        '• Failed',
        '• Opened a pull request: https://github.com/acme/web/pull/128',
      ]),
    );
    expect(stub.slack.posted[0]!.text).not.toContain('Which bucket');
  });

  it('batches a busy chat into one message and counts repeats', async () => {
    await ask('execute', 'one');
    await changed('approval');
    await ask('execute', 'two');
    await ask('execute', 'three');
    notifier.changed({ kind: 'approval', conversationId: chat.conversationId, runId: null });
    notifier.changed({ kind: 'approval', conversationId: chat.conversationId, runId: null });
    await finish('succeeded');
    await changed();

    expect(stub.slack.posted).toHaveLength(2);
    expect(stub.slack.posted[1]!.text).toContain('• Needs your approval (2)');
    expect(stub.slack.posted[1]!.text).toContain('• Finished');
  });

  it('holds a batch until the window passes and drops approvals answered meanwhile', async () => {
    const slow = startSlackNotifier(deps, { since: SINCE, batchMs: 60_000 });
    const approval = await ask('execute', 'one');
    slow.changed({ kind: 'approval', conversationId: chat.conversationId, runId: null });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(stub.slack.posted).toHaveLength(0);

    await t.db.query(
      "UPDATE approvals SET status = 'cancelled', decided_by = 'stop', decided_at = now() WHERE id = $1",
      [approval.id],
    );
    await slow.stop();

    expect(stub.slack.posted).toHaveLength(0);
    expect(await deliveries()).toEqual([
      { kind: 'needs_you', outcome: 'skipped', reason: 'resolved' },
    ]);
  });

  it('stays quiet while Spark is focused, unless quiet is off', async () => {
    notifier.setFocused(true);
    await ask('execute', 'one');
    await changed('approval');
    expect(stub.slack.posted).toHaveLength(0);
    expect(await deliveries()).toEqual([
      { kind: 'needs_you', outcome: 'skipped', reason: 'focused' },
    ]);

    await changeSlackSettings(deps, { quietWhenFocused: false });
    await finish('succeeded');
    await changed();
    expect(stub.slack.posted).toHaveLength(1);

    notifier.setFocused(false);
  });

  it('stays quiet while one client is focused after another blurs', async () => {
    notifier.setFocused(true, 'local:window');
    notifier.setFocused(true, 'device:phone');
    notifier.setFocused(false, 'local:window');
    await ask('execute', 'one');
    await changed('approval');
    expect(stub.slack.posted).toHaveLength(0);

    notifier.setFocused(false, 'device:phone');
    await finish('succeeded');
    await changed();
    expect(stub.slack.posted).toHaveLength(1);
  });

  it('respects the per-event switches and sends flags only when asked', async () => {
    await changeSlackSettings(deps, { notify: { finished: false } });
    await finish('succeeded');
    await t.db.query(
      `INSERT INTO rail_flags (id, run_id, conversation_id, rail, title, inside)
       VALUES ($1, $2, $3, 'force_push', 'git push --force', true)`,
      [randomUUID(), chat.runId, chat.conversationId],
    );
    await changed();

    expect(stub.slack.posted).toHaveLength(0);
    expect((await deliveries()).map((row) => row.reason)).toEqual(['off', 'off']);

    await changeSlackSettings(deps, { notify: { flag: true } });
    await t.db.query(
      `INSERT INTO rail_flags (id, run_id, conversation_id, rail, title, inside)
       VALUES ($1, $2, $3, 'force_push', 'git push --force', true)`,
      [randomUUID(), chat.runId, chat.conversationId],
    );
    await changed('conversation');
    expect(stub.slack.posted).toHaveLength(1);
    expect(stub.slack.posted[0]!.text).toContain('Flagged an action that crossed a guardrail');
    expect(stub.slack.posted[0]!.text).not.toContain('git push');
  });

  it('uses the chosen channel instead of a direct message', async () => {
    await changeSlackSettings(deps, { notifyChannelId: 'C0ENG' });
    await finish('succeeded');
    await changed();

    expect(stub.slack.posted[0]).toMatchObject({ channel: 'C0ENG' });
  });

  it('ignores what happened before it started and child runs', async () => {
    const late = startSlackNotifier(deps, { since: new Date(Date.now() + 60_000) });
    await finish('succeeded');
    late.changed({ kind: 'run', conversationId: chat.conversationId, runId: chat.runId });
    await late.stop();

    expect(stub.slack.posted).toHaveLength(0);
    expect(await deliveries()).toEqual([]);
  });

  it('a failed delivery is recorded and shown in Settings, and nothing throws', async () => {
    stub.slack.failPosts = 'channel_not_found';
    await finish('succeeded');
    await changed();

    expect(await deliveries()).toEqual([
      { kind: 'finished', outcome: 'failed', reason: expect.stringContaining('/invite') },
    ]);
    const status = await slackStatus(deps);
    expect(status.connection?.lastProblem?.message).toContain("Couldn't send a notification");
    const run = await t.db.query('SELECT status FROM runs WHERE id = $1', [chat.runId]);
    expect(run.rows[0]).toEqual({ status: 'succeeded' });

    stub.slack.failPosts = null;
    await ask('execute', 'again');
    await changed('approval');
    expect((await slackStatus(deps)).connection?.lastProblem).toBeNull();
  });

  it('waits out a Slack rate limit instead of dropping the message', async () => {
    stub.slack.rateLimitNext = 1;
    await finish('succeeded');
    await changed();

    expect(stub.slack.posted).toHaveLength(1);
  });

  it('does nothing when Slack is not connected', async () => {
    await t.db.query('DELETE FROM slack_connections');
    await finish('succeeded');
    await changed();

    expect(stub.slack.posted).toHaveLength(0);
  });

  it('replies in the thread a chat started from when it finishes or opens a PR', async () => {
    await saveSlackChatThread(t.db, t.workspaceId, chat.conversationId, {
      channelId: 'C0ENG',
      threadTs: '1760000000.000100',
      permalink: 'https://acme.slack.com/archives/C0ENG/p1760000000000100',
      postUpdates: true,
    });
    await finish('succeeded');
    await openPr();
    await changed();
    await changed();

    const inThread = stub.slack.posted.filter((post) => post.threadTs === '1760000000.000100');
    expect(inThread.map((post) => post.text)).toEqual([
      'Spark finished this work.',
      'Spark opened a pull request: https://github.com/acme/web/pull/128',
    ]);
    expect(inThread.every((post) => post.channel === 'C0ENG')).toBe(true);
  });

  it('never stores message text or tokens', async () => {
    await ask('execute', 'Run rm -rf build');
    await changed('approval');
    const { rows } = await t.db.query('SELECT * FROM slack_deliveries');

    expect(JSON.stringify(rows)).not.toContain('upload retry');
    expect(await databaseText(t)).not.toContain('xoxb-');
  });
});
