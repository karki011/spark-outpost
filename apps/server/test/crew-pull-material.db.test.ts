import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MATERIAL_START } from '../src/crew-flows/step-prompt.ts';
import { saveGitHubToken } from '../src/persistence/github-tokens.ts';
import { turnObservations } from '../src/persistence/observations.ts';
import { getRun } from '../src/persistence/runs.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { repoWithPull } from './crew-pr-checkout-support.ts';
import {
  newSpark,
  recordOf,
  saveFlow,
  statesOf,
  step,
  useWorkflowsDir,
} from './crew-workflow-support.ts';
import { TOKEN_LOGIN, type FakePull } from './fake-github.ts';
import { shipAccessTo } from './publish-step-support.ts';
import { startGitHubStub, type GitHubStub } from './ship-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import { openChat, repliesOf, sendMessage } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

const OTHER_URL = 'https://github.com/someone/else/pull/3';
const OTHER_ID = 'someone/else#3';
const PATCH = '@@ -1 +1 @@\n-old line\n+new line';

let t: TestDb;
let base: string;
let stub: GitHubStub;
let harness: Worker | null = null;
let dropWorkflows: () => Promise<void>;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'spark-pull-material-'));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  stub = await startGitHubStub();
  dropWorkflows = await useWorkflowsDir();
  await connectAgents(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await stub.close();
  await t.cleanup();
  await dropWorkflows();
});

function otherPull(): FakePull {
  return {
    number: 3,
    owner: 'someone',
    repo: 'else',
    title: 'Tidy the parser',
    body: 'Body of the other pull request',
    head: 'tidy-parser',
    base: 'main',
    draft: false,
    state: 'open',
    html_url: OTHER_URL,
    openedBy: 'alice',
    requestedReviewers: [],
    via: 'token',
    sha: 'c'.repeat(40),
    updated_at: new Date().toISOString(),
    files: [
      { filename: 'src/parser.ts', status: 'modified', additions: 1, deletions: 1, patch: PATCH },
    ],
  };
}

async function workerSignedIn() {
  const access = shipAccessTo(stub.url);
  await access.secrets.set('github', 'ghp_test_token');
  await saveGitHubToken(t.db, t.workspaceId, {
    host: 'github.com',
    login: TOKEN_LOGIN,
    scopes: ['repo'],
    expiresAt: null,
    repos: [],
  });
  harness = startTurnWorker(t, { shipAccess: access });
}

async function finished(runId: string) {
  await eventually(async () => ((await getRun(t.db, runId))?.finishedAt ? true : null), 60_000);
  return recordOf(t, runId);
}

async function promptOf(runId: string): Promise<string> {
  const { rows } = await t.db.query<{ prompt: string }>('SELECT prompt FROM runs WHERE id = $1', [
    runId,
  ]);
  return rows[0]?.prompt ?? '';
}

async function lookFlow() {
  const pip = await newSpark(t, 'Pip');
  const dot = await newSpark(t, 'Dot');
  await saveFlow(t, 'check', [
    step('look', pip.id),
    step('judge', dot.id, { dependsOn: ['look'] }),
  ]);
}

describe('a workflow run named for a pull request in a repository the chat has not linked', () => {
  it('gives every step the pull request read from GitHub in a chat with no project', async () => {
    stub.github.pulls.push(otherPull());
    await workerSignedIn();
    await lookFlow();

    const runId = await sendMessage(t, await openChat(t), `@check review this pr ${OTHER_URL}`);
    const record = await finished(runId);

    expect(record).toMatchObject({ status: 'succeeded', pull: OTHER_ID });
    expect(stub.github.requests.map((request) => request.path)).toContain(
      '/repos/someone/else/pulls/3',
    );
    for (const entry of record!.steps) {
      const prompt = await promptOf(entry.runId!);
      expect(prompt).toContain('Spark read it from GitHub');
      expect(prompt).toContain(MATERIAL_START);
      expect(prompt).toContain('Title: Tidy the parser');
      expect(prompt).toContain(`Head commit: ${'c'.repeat(40)}`);
      expect(prompt).toContain('+new line');
      expect(prompt).not.toContain('read it from GitHub.');
    }
    const [note] = await repliesOf(t, runId);
    expect(note).toContain(`Pull request ${OTHER_ID} is not in a repository linked to this chat`);
    expect(note).toContain('Spark read it from GitHub and gave the steps');
    expect(await turnObservations(t.db, runId)).toContainEqual({
      source: 'private_data',
      label: `private work data (pull request ${OTHER_ID})`,
    });
  }, 90_000);

  it('starts no step when the chat has no project and GitHub cannot be read', async () => {
    harness = startTurnWorker(t);
    await lookFlow();

    const runId = await sendMessage(t, await openChat(t), `@check review this pr ${OTHER_URL}`);
    const record = await finished(runId);
    const run = await getRun(t.db, runId);

    expect(record?.status).toBe('failed');
    expect(statesOf(record)).toEqual({ look: 'skipped', judge: 'skipped' });
    expect(record!.steps.every((entry) => entry.runId === null)).toBe(true);
    expect(run?.status).toBe('failed');
    expect(run?.error).toContain('Workflow Flow check did not start');
    expect(run?.error).toContain(`could not read pull request ${OTHER_ID} from GitHub`);
    expect(run?.error).toContain('no GitHub connection reaches someone/else');
  }, 90_000);

  it('stops the same way when GitHub does not return the pull request', async () => {
    await workerSignedIn();
    await lookFlow();

    const runId = await sendMessage(t, await openChat(t), `@check review this pr ${OTHER_URL}`);
    const record = await finished(runId);

    expect(statesOf(record)).toEqual({ look: 'skipped', judge: 'skipped' });
    expect((await getRun(t.db, runId))?.error).toContain('GitHub did not return it');
  }, 90_000);

  it('does not read a linked repository of the same name for a link on another host', async () => {
    stub.github.pulls.push({ ...otherPull(), owner: 'acme', repo: 'widgets', number: 7 });
    await workerSignedIn();
    await lookFlow();
    const repo = await repoWithPull(base, 'hosted');
    await openChat(t, { root: repo.root });

    const link = 'https://git.example/acme/widgets/pull/7';
    const record = await finished(await sendMessage(t, await openChat(t), `@check review ${link}`));

    expect(statesOf(record)).toEqual({ look: 'skipped', judge: 'skipped' });
    expect(stub.github.requests.map((request) => request.path)).not.toContain(
      '/repos/acme/widgets/pulls/7',
    );
  }, 90_000);

  it('gives the steps the pull request in a chat whose project is another repository', async () => {
    stub.github.pulls.push(otherPull());
    await workerSignedIn();
    await lookFlow();
    const repo = await repoWithPull(base, 'widgets');

    const chat = await openChat(t, { root: repo.root, level: 'hands-off' });
    const runId = await sendMessage(t, chat, `@check look at ${OTHER_URL}`);
    const record = await finished(runId);

    expect(record?.status).toBe('succeeded');
    const prompt = await promptOf(record!.steps[0]!.runId!);
    expect(prompt).toContain('Spark read it from GitHub');
    expect(prompt).toContain('+new line');
  }, 90_000);

  it('still runs in a chat with a project when GitHub cannot be read', async () => {
    harness = startTurnWorker(t);
    await lookFlow();
    const repo = await repoWithPull(base, 'gadgets');

    const chat = await openChat(t, { root: repo.root, level: 'hands-off' });
    const record = await finished(await sendMessage(t, chat, `@check look at ${OTHER_URL}`));

    expect(record?.status).toBe('succeeded');
    expect(await promptOf(record!.steps[0]!.runId!)).toContain(
      `pull request ${OTHER_ID}, which is not in a repository linked to this chat, so it is not checked out: read it from GitHub.`,
    );
  }, 90_000);
});
