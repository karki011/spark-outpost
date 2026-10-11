import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { modeForLegacy, type InvolvementLevel } from '@spark-outpost/contracts';
import { ghRailReason } from '../src/approvals/publish-policy.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import { getTaskShip } from '../src/persistence/task-ships.ts';
import { PUSHED_WITHOUT_PR } from '../src/ship/published.ts';
import { KEPT_RECORD_TITLE } from '../src/workflow/kept-record-writer.ts';
import { PUBLISH_PROMPT_HEADING } from '../src/workflow/publish-prompt.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { THREAD_REPLY_COMMAND } from './fake-acp-build.ts';
import {
  CHAT_BRANCH,
  chatOnItsBranch,
  promptsOf,
  shipAccessTo,
  type BranchChat,
} from './publish-step-support.ts';
import { git, startGitHubStub, type GitHubStub } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { changesOf, driveToEnd, repliesOf, sendMessage } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

const BUILD = 'The divider shows the wrong day after midnight. Fix it. #build';
const PULL_URL = 'https://github.com/acme/widgets/pull/1';

let t: TestDb;
let base: string;
let stub: GitHubStub;
let worker: Worker;
let chats = 0;

const ghState = () => path.join(base, 'gh-state');

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-publish-step-')));
  process.env.FAKE_GH_NODE = process.execPath;
  process.env.FAKE_GH_STATE = ghState();
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  stub = await startGitHubStub();
  process.env.FAKE_GH_API = stub.url;
  await writeFile(ghState(), 'octo-cli');
  await connectAgents(t);
  chats += 1;
  worker = startTurnWorker(t, {
    shipAccess: shipAccessTo(stub.url),
    sessions: path.join(base, `sessions-${chats}`),
  });
});

afterEach(async () => {
  await worker.stop();
  await stub.close();
  await t.cleanup();
});

async function turn(chat: BranchChat, text: string, level: InvolvementLevel) {
  const runId = await sendMessage(t, chat.conversationId, text, { permission: 'do', level });
  const { run } = await driveToEnd(t, chat.conversationId, runId);
  expect(run.status).toBe('succeeded');
  return { runId, replies: await repliesOf(t, runId), prompts: await promptsOf(t, runId) };
}

const onRemote = (chat: BranchChat) => git(chat.repo.bare, 'branch', '--list', CHAT_BRANCH) !== '';

async function followUpRound(chat: BranchChat, tags: string): Promise<string> {
  const sent = await sendUserMessage(
    t.db,
    chat.conversationId,
    {
      id: randomUUID(),
      content: `PR follow-up, round 1: acme/widgets#1 ${tags}`,
      source: 'pr_follow_up',
    },
    {
      provider: 'claude',
      model: 'sonnet',
      effort: 'medium',
      permission: 'do',
      agentMode: modeForLegacy('claude', 'do', 'hands-off'),
      level: 'hands-off',
    },
  );
  const { run } = await driveToEnd(t, chat.conversationId, sent.run.id);
  expect(run.status).toBe('succeeded');
  return sent.run.id;
}

async function replyCards(runId: string) {
  const { rows } = await t.db.query<{ status: string; decided_by: string; reason: string | null }>(
    `SELECT status, decided_by, reason FROM approvals
     WHERE run_id = $1 AND payload->>'command' = $2 ORDER BY created_at`,
    [runId, THREAD_REPLY_COMMAND],
  );
  return rows;
}

async function watched(conversationId: string) {
  const { rows } = await t.db.query<{ number: number; branch: string }>(
    'SELECT number, branch FROM pr_watches WHERE conversation_id = $1',
    [conversationId],
  );
  return rows;
}

describe('the publish step after the agent’s reply', { timeout: 120_000 }, () => {
  it('Full auto → PR: one more prompt to the same session pushes, opens the pull request and Spark records it', async () => {
    const chat = await chatOnItsBranch(t, base, `widgets-${chats}`, 'full-auto');
    const { runId, replies, prompts } = await turn(chat, BUILD, 'full-auto');

    expect(prompts).toBe(2);
    const sessions = await t.db.query(
      'SELECT 1 FROM provider_sessions WHERE conversation_id = $1',
      [chat.conversationId],
    );
    expect(sessions.rowCount).toBe(1);
    expect(stub.github.pulls).toHaveLength(1);
    expect(stub.github.pulls[0]).toMatchObject({ head: CHAT_BRANCH, base: 'main', draft: false });
    expect(stub.github.pulls[0]!.body).toContain(PUBLISH_PROMPT_HEADING);
    expect(replies).toHaveLength(2);
    expect(replies[1]).toContain(`Opened pull request #1: ${PULL_URL}`);
    expect(await watched(chat.conversationId)).toEqual([{ number: 1, branch: CHAT_BRANCH }]);
    const run = await t.db.query<{ task_id: string }>('SELECT task_id FROM runs WHERE id = $1', [
      runId,
    ]);
    expect(await getTaskShip(t.db, run.rows[0]!.task_id)).toMatchObject({
      branch: CHAT_BRANCH,
      prNumber: 1,
    });
  });

  it('keeps one changes snapshot and one set of totals for the run across both prompts', async () => {
    const chat = await chatOnItsBranch(t, base, `widgets-${chats}`, 'full-auto');
    const { runId } = await turn(chat, BUILD, 'full-auto');

    expect(await changesOf(t, runId)).toMatchObject({
      files: [{ path: 'notes.txt', change: 'modified' }],
    });
    const { rows } = await t.db.query<{ tool_call_count: number }>(
      'SELECT tool_call_count FROM runs WHERE id = $1',
      [runId],
    );
    expect(rows[0]!.tool_call_count).toBe(3);
  });

  it('a message that asks for a pull request gets the publish prompt at Automatic', async () => {
    const chat = await chatOnItsBranch(t, base, `widgets-${chats}`, 'hands-off');
    const asked = `${BUILD} Then take it all the way to a PR.`;
    const { replies, prompts } = await turn(chat, asked, 'hands-off');

    expect(prompts).toBe(2);
    expect(stub.github.pulls).toHaveLength(1);
    expect(replies.at(-1)).toContain('Opened pull request #1');
  });

  it('opens a draft only when Settings says pull requests open as drafts', async () => {
    await updateProfile(t.db, t.workspaceId, { prReadyForReview: false });
    const chat = await chatOnItsBranch(t, base, `widgets-${chats}`, 'full-auto');
    await turn(chat, BUILD, 'full-auto');

    expect(stub.github.pulls).toMatchObject([{ head: CHAT_BRANCH, draft: true }]);
  });

  it('a message that does not ask stays unpublished at Automatic', async () => {
    const chat = await chatOnItsBranch(t, base, `widgets-${chats}`, 'hands-off');
    const { replies, prompts } = await turn(chat, BUILD, 'hands-off');

    expect(prompts).toBe(1);
    expect(replies).toHaveLength(1);
    expect(replies[0]).not.toMatch(/pull request/i);
    expect(stub.github.pulls).toEqual([]);
    expect(onRemote(chat)).toBe(false);
  });

  it('sends nothing when the turn changed nothing, even at Full auto → PR', async () => {
    const chat = await chatOnItsBranch(t, base, `widgets-${chats}`, 'full-auto');
    const { replies, prompts } = await turn(chat, 'What does the divider show?', 'full-auto');

    expect(prompts).toBe(1);
    expect(replies).toHaveLength(1);
    expect(replies[0]).not.toMatch(/pull request/i);
    expect(onRemote(chat)).toBe(false);
  });

  it('leaves work an earlier turn kept unpublished when this turn changed nothing', async () => {
    const chat = await chatOnItsBranch(t, base, `widgets-${chats}`, 'full-auto');
    await turn(chat, BUILD, 'hands-off');
    const { replies, prompts } = await turn(chat, 'What changed?', 'full-auto');

    expect(prompts).toBe(1);
    expect(replies).toHaveLength(1);
    expect(stub.github.pulls).toEqual([]);
    expect(onRemote(chat)).toBe(false);
  });

  it('ends the run as succeeded, with the change kept and one line, when the publish prompt fails', async () => {
    await worker.stop();
    worker = startTurnWorker(t, {
      shipAccess: shipAccessTo(stub.url),
      sessions: path.join(base, `sessions-${chats}-failing`),
      agentEnv: { FAKE_ACP_PUBLISH_FAILS: '1' },
    });
    const chat = await chatOnItsBranch(t, base, `widgets-${chats}`, 'full-auto');
    const { runId, replies, prompts } = await turn(chat, BUILD, 'full-auto');

    expect(prompts).toBe(2);
    expect(replies[0]).not.toContain('Not published');
    expect(replies.at(-1)).toMatch(/Not published: the publish step failed\./);
    expect(stub.github.pulls).toEqual([]);
    const kept = await t.db.query(
      `SELECT 1 FROM approvals WHERE run_id = $1 AND kind = 'accept' AND title = $2`,
      [runId, KEPT_RECORD_TITLE],
    );
    expect(kept.rowCount).toBe(1);
    expect(await changesOf(t, runId)).toMatchObject({
      files: [{ path: 'notes.txt', change: 'modified' }],
    });
  });

  it('sends nothing more once the branch is pushed and its pull request is open', async () => {
    const chat = await chatOnItsBranch(t, base, `widgets-${chats}`, 'full-auto');
    await turn(chat, BUILD, 'full-auto');
    const { replies, prompts } = await turn(chat, 'What changed?', 'full-auto');

    expect(prompts).toBe(1);
    expect(replies).toHaveLength(1);
    expect(stub.github.pulls).toHaveLength(1);
  });

  it('without a GitHub connection the branch is pushed and the reply links Create PR', async () => {
    await rm(ghState());
    const chat = await chatOnItsBranch(t, base, `widgets-${chats}`, 'full-auto');
    const { replies } = await turn(chat, BUILD, 'full-auto');

    expect(stub.github.pulls).toEqual([]);
    expect(onRemote(chat)).toBe(true);
    expect(replies.at(-1)).toContain(PUSHED_WITHOUT_PR);
    expect(replies.at(-1)).toContain(
      `https://github.com/acme/widgets/compare/main...${encodeURIComponent(CHAT_BRANCH)}`,
    );
  });

  it('a follow-up round pushes the fix to the same branch and opens no second pull request', async () => {
    const chat = await chatOnItsBranch(t, base, `widgets-${chats}`, 'full-auto');
    await turn(chat, BUILD, 'full-auto');
    const before = git(chat.repo.bare, 'rev-parse', CHAT_BRANCH);
    const runId = await followUpRound(chat, '#build');

    expect(await promptsOf(t, runId)).toBe(2);
    expect(stub.github.pulls).toHaveLength(1);
    expect(git(chat.repo.bare, 'rev-parse', CHAT_BRANCH)).not.toBe(before);
    expect((await repliesOf(t, runId)).at(-1)).toContain('Pushed the fix to pull request #1.');
  });

  it("a follow-up round's reply on the chat's own thread gets the mode's ordinary card, and is refused by name once follow-up is off", async () => {
    const chat = await chatOnItsBranch(t, base, `widgets-${chats}`, 'full-auto');
    await turn(chat, BUILD, 'full-auto');

    const followed = await followUpRound(chat, '#build #reply');
    expect(await replyCards(followed)).toEqual([
      { status: 'allowed', decided_by: 'user', reason: null },
    ]);

    await updateProfile(t.db, t.workspaceId, { prFollowUp: false });
    const off = await followUpRound(chat, '#build #reply');
    expect(await replyCards(off)).toEqual([
      { status: 'denied', decided_by: 'policy', reason: ghRailReason('gh api') },
    ]);
  });
});
