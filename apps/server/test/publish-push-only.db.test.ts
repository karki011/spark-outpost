import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { publishGrant, publishScope } from '../src/workflow/publish-context.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import type { Worker } from '../src/workflow/worker.ts';
import {
  CHAT_BRANCH,
  chatOnItsBranch,
  promptsOf,
  shipAccessTo,
  type BranchChat,
} from './publish-step-support.ts';
import { git, startGitHubStub, type GitHubStub } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { driveToEnd, repliesOf, sendMessage } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

const MANUAL = 'default';
const PUSH_ONLY =
  'The divider shows the wrong day after midnight. Fix it. #build Push this branch, but do not open a pull request.';

let t: TestDb;
let base: string;
let stub: GitHubStub;
let worker: Worker;
let chat: BranchChat;

const ghState = () => path.join(base, 'gh-state');

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-push-only-')));
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
  const name = `widgets-${Date.now()}`;
  worker = startTurnWorker(t, {
    shipAccess: shipAccessTo(stub.url),
    sessions: path.join(base, `sessions-${name}`),
  });
  chat = await chatOnItsBranch(t, base, name, 'hands-off');
});

afterEach(async () => {
  await worker.stop();
  await stub.close();
  await t.cleanup();
});

async function turn(text: string) {
  const runId = await sendMessage(t, chat.conversationId, text, {
    permission: 'do',
    agentMode: MANUAL,
    level: 'hands-off',
  });
  const { run } = await driveToEnd(t, chat.conversationId, runId);
  expect(run.status).toBe('succeeded');
  return runId;
}

async function pullCommands(runId: string) {
  const { rows } = await t.db.query<{ command: string }>(
    `SELECT payload->>'command' AS command FROM approvals
     WHERE run_id = $1 AND payload->>'command' LIKE 'gh pr create%'`,
    [runId],
  );
  return rows;
}

describe(
  'a message that asks for the push and declines the pull request',
  { timeout: 120_000 },
  () => {
    it('pushes the branch with one more prompt, opens no pull request and says so in one line', async () => {
      const runId = await turn(PUSH_ONLY);

      expect(await promptsOf(t, runId)).toBe(2);
      expect(git(chat.repo.bare, 'branch', '--list', CHAT_BRANCH)).not.toBe('');
      expect(stub.github.pulls).toEqual([]);
      expect(await pullCommands(runId)).toEqual([]);
      const replies = await repliesOf(t, runId);
      expect(replies.at(-1)).toContain(`Pushed ${CHAT_BRANCH}. No pull request was asked for.`);
      expect(replies.at(-1)).not.toContain('Create it');
    });

    it('gives the gate and the publish tools the push and not the pull request', async () => {
      const runId = await turn(PUSH_ONLY);
      const input = await loadRunInput(t.db, runId);

      expect(publishGrant(input)).toMatchObject({
        requested: true,
        asked: { push: true, pull: false },
      });
      expect(await publishScope(t.db, input)).toMatchObject({
        basis: 'requested',
        opensPull: false,
        pushOnly: true,
      });
      const auto = await publishScope(t.db, { ...input, agentMode: 'auto' });
      expect(auto).toMatchObject({ basis: 'requested', opensPull: true, pushOnly: true });
    });

    it('sends nothing more once the branch is pushed in full', async () => {
      await turn(PUSH_ONLY);
      const runId = await turn('Push this branch, but do not open a pull request.');

      expect(await promptsOf(t, runId)).toBe(1);
      expect(stub.github.pulls).toEqual([]);
    });
  },
);
