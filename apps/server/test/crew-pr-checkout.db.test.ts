import { randomUUID } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { workflowSchema, type WorkflowRunStatus } from '@spark-outpost/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  checkoutChanges,
  checkoutNote,
  placeRunPull,
  removeRunCheckout,
  sweepRecordedCheckouts,
  sweepUnclaimedCheckouts,
  type PullPlace,
} from '../src/crew-flows/pr-checkout.ts';
import { finishWorkflowRun, insertWorkflowRun } from '../src/crew-flows/run-records.ts';
import { linkedConversation } from './approval-support.ts';
import {
  PULL_ID,
  checkoutRefs,
  repoWithPull,
  worktreeList,
  type PullRepo,
} from './crew-pr-checkout-support.ts';
import { newSpark } from './crew-workflow-support.ts';
import { CHAT_BRANCH } from './publish-step-support.ts';
import { git } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let repo: PullRepo;
let conversationId: string;
let sparkId: string;
let repos = 0;

const exists = (target: string) =>
  access(target).then(
    () => true,
    () => false,
  );

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'spark-pr-checkout-'));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
  repos += 1;
  repo = await repoWithPull(base, `widgets-${repos}`);
  conversationId = (await linkedConversation(t, repo.root)).conversationId;
  sparkId = (await newSpark(t, 'Pip')).id;
});

afterEach(async () => {
  await t.cleanup();
});

async function newRun(pull = PULL_ID): Promise<string> {
  const id = randomUUID();
  await insertWorkflowRun(t.db, {
    id,
    workspaceId: t.workspaceId,
    workflow: workflowSchema.parse({
      id: 'check',
      name: 'Check',
      steps: [{ id: 'look', sparkId }],
    }),
    kind: 'run',
    source: 'manual',
    conversationId,
    runId: null,
    message: '',
    continues: false,
    pull,
  });
  return id;
}

function place(workflowRunId: string, pullId = PULL_ID, roots = [repo.root]) {
  return placeRunPull({
    db: t.db,
    workspaceId: t.workspaceId,
    workflowRunId,
    pullId,
    roots,
    prepare: async () => undefined,
  });
}

function checkoutOf(placed: PullPlace) {
  if (placed.kind !== 'checkout') throw new Error(`Expected a checkout, got ${placed.kind}`);
  return placed;
}

async function recordedPath(id: string): Promise<string | null> {
  const { rows } = await t.db.query<{ checkout_path: string | null }>(
    'SELECT checkout_path FROM workflow_runs WHERE id = $1',
    [id],
  );
  return rows[0]?.checkout_path ?? null;
}

describe('a workflow run about a pull request that is not the chat’s branch', () => {
  it('checks out the pull request head in a detached worktree and leaves the chat alone', async () => {
    const id = await newRun();
    const checkout = checkoutOf(await place(id));

    expect(checkout.head).toBe(repo.pullHead);
    expect(git(checkout.path, 'rev-parse', 'HEAD')).toBe(repo.pullHead);
    expect(worktreeList(repo.root)).toContain(
      `worktree ${checkout.path}\nHEAD ${repo.pullHead}\ndetached`,
    );
    expect(await readFile(path.join(checkout.path, 'notes.txt'), 'utf8')).toBe(
      'from the pull request\n',
    );
    expect(checkout.path).toBe(path.join(repo.root, '.spark', 'worktrees', `pr-${id}`));
    expect(await recordedPath(id)).toBe(checkout.path);
    expect(git(repo.root, 'symbolic-ref', '--short', 'HEAD')).toBe(CHAT_BRANCH);
    expect(await readFile(path.join(repo.root, 'notes.txt'), 'utf8')).toBe('one\n');
    expect(git(repo.root, 'status', '--porcelain')).toBe('');
  });

  it('reuses its checkout when the turn picks the run up again', async () => {
    const id = await newRun();
    const first = checkoutOf(await place(id));
    await writeFile(path.join(first.path, 'kept.txt'), 'still here\n');

    const again = checkoutOf(await place(id));

    expect(again.path).toBe(first.path);
    expect(await exists(path.join(again.path, 'kept.txt'))).toBe(true);
  });

  it('removes the checkout, its ref and its worktree entry, and names what steps changed', async () => {
    const id = await newRun();
    const checkout = checkoutOf(await place(id));
    await writeFile(path.join(checkout.path, 'notes.txt'), 'edited by a step\n');
    await writeFile(path.join(checkout.path, 'new.txt'), 'new\n');

    const changed = await checkoutChanges(checkout.path);
    await removeRunCheckout(t.db, id);

    expect(changed).toEqual(['new.txt', 'notes.txt']);
    expect(await exists(checkout.path)).toBe(false);
    expect(worktreeList(repo.root)).not.toContain(checkout.path);
    expect(checkoutRefs(repo.root)).toBe('');
    expect(await recordedPath(id)).toBeNull();
    expect(checkoutNote(checkout, changed)).toContain(
      'changed 2 files there (new.txt, notes.txt); nothing was committed, so those changes were discarded',
    );
  });

  it('gives two runs on the same pull request their own checkouts', async () => {
    const [one, two] = await Promise.all([newRun(), newRun()]);
    const [first, second] = (await Promise.all([place(one!), place(two!)])).map(checkoutOf);

    expect(first!.path).not.toBe(second!.path);
    await removeRunCheckout(t.db, one!);

    expect(await exists(first!.path)).toBe(false);
    expect(git(second!.path, 'rev-parse', 'HEAD')).toBe(repo.pullHead);
    expect(checkoutRefs(repo.root)).toBe(`refs/spark-outpost/pr-checkouts/${two}`);
    expect(await recordedPath(two!)).toBe(second!.path);
  });
});

describe('when no checkout is made', () => {
  it('keeps steps on GitHub for a pull request in a repository the chat has not linked', async () => {
    const id = await newRun('someone/else#3');
    const placed = await place(id, 'someone/else#3');

    expect(placed).toEqual({
      kind: 'unlinked',
      pull: { id: 'someone/else#3', owner: 'someone', repo: 'else', number: 3 },
    });
    expect(await recordedPath(id)).toBeNull();
    expect(await exists(path.join(repo.root, '.spark', 'worktrees'))).toBe(false);
    expect(checkoutNote(placed, [])).toBe(
      'Pull request someone/else#3 is not in a repository linked to this chat, so the steps read it from GitHub instead of a checkout.',
    );
  });

  it('does nothing for the chat’s own pull request on its branch', async () => {
    await t.db.query(
      `INSERT INTO pr_watches (id, workspace_id, conversation_id, host, owner, repo, number, url, branch)
       VALUES ($1, $2, $3, 'github.com', 'acme', 'widgets', 7, 'https://github.com/acme/widgets/pull/7', $4)`,
      [randomUUID(), t.workspaceId, conversationId, CHAT_BRANCH],
    );
    const id = await newRun();

    expect(await place(id)).toEqual({ kind: 'none' });
    expect(checkoutRefs(repo.root)).toBe('');
    expect(await recordedPath(id)).toBeNull();
  });

  it('does nothing when the chat already has the pull request head checked out', async () => {
    git(repo.root, 'reset', '-q', '--hard', repo.pullHead);
    const id = await newRun();

    expect(await place(id)).toEqual({ kind: 'none' });
    expect(checkoutRefs(repo.root)).toBe('');
  });

  it('says so and stays on the chat’s branch when the pull request cannot be fetched', async () => {
    const id = await newRun('acme/widgets#99');
    const placed = await place(id, 'acme/widgets#99');

    expect(placed.kind).toBe('unfetched');
    expect(await recordedPath(id)).toBeNull();
    expect(checkoutNote(placed, [])).toContain('could not fetch pull request acme/widgets#99');
  });
});

describe('cleaning up checkouts the run left behind', () => {
  it.each<Exclude<WorkflowRunStatus, 'running'>>(['succeeded', 'failed', 'cancelled'])(
    'removes the checkout of a run that %s',
    async (status) => {
      const id = await newRun();
      const checkout = checkoutOf(await place(id));
      expect(await sweepRecordedCheckouts(t.db)).toBe(0);
      expect(await exists(checkout.path)).toBe(true);

      await finishWorkflowRun(t.db, id, status, null);
      expect(await sweepRecordedCheckouts(t.db)).toBe(1);

      expect(await exists(checkout.path)).toBe(false);
      expect(checkoutRefs(repo.root)).toBe('');
      expect(await recordedPath(id)).toBeNull();
    },
  );

  it('removes folders and refs no running run claims after a restart, and keeps the rest', async () => {
    const gone = await newRun();
    const orphan = checkoutOf(await place(gone));
    await t.db.query('DELETE FROM workflow_runs WHERE id = $1', [gone]);
    const live = await newRun();
    const running = checkoutOf(await place(live));

    expect(await sweepUnclaimedCheckouts(t.db)).toBe(1);

    expect(await exists(orphan.path)).toBe(false);
    expect(worktreeList(repo.root)).not.toContain(orphan.path);
    expect(await exists(running.path)).toBe(true);
    expect(checkoutRefs(repo.root)).toBe(`refs/spark-outpost/pr-checkouts/${live}`);
  });
});
