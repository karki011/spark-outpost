import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { primaryChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { placeChat } from '../src/orchestration/chat-place.ts';
import { bringChanges } from '../src/projects/chat-worktrees.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { doRun } from './approval-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let scratch: string;
let upstream: string;
let checkout: string;

const AUTHOR = ['-c', 'user.email=t@t', '-c', 'user.name=t'];

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...AUTHOR, ...args], { encoding: 'utf8' }).trim();
}

async function commitFile(root: string, file: string, text: string): Promise<string> {
  await writeFile(join(root, file), text);
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', `change ${file}`);
  return git(root, 'rev-parse', 'HEAD');
}

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'spark-fresh-base-')));
  upstream = join(scratch, 'upstream');
  checkout = join(scratch, 'checkout');
  await mkdir(upstream);
  git(upstream, 'init', '-q', '-b', 'main');
  await commitFile(upstream, 'app.ts', 'one\n');
  execFileSync('git', ['clone', '-q', upstream, checkout]);
});

afterEach(async () => {
  await t.cleanup();
  await rm(scratch, { recursive: true, force: true });
});

async function place() {
  const { runId } = await doRun(t, checkout);
  const input = await loadRunInput(t.db, runId);
  const placed = await placeChat({ db: t.db, branchPrefix: 'spark' }, input, true);
  const record = await primaryChatWorktree(t.db, input.identity.threadId);
  return { placed, record: record! };
}

describe('a new chat worktree', { timeout: 60_000 }, () => {
  it('starts from the fetched origin default branch when local main is behind', async () => {
    const newer = await commitFile(upstream, 'vitest.config.ts', 'export default {};\n');
    const { placed, record } = await place();
    expect(placed.input.chatWorktree).toBe(true);
    expect(record.baseCommit).toBe(newer);
    expect(record.baseRef).toBe('origin/main');
    expect(record.baseBranch).toBe('main');
    expect(git(record.path, 'rev-parse', 'HEAD')).toBe(newer);
    expect(git(checkout, 'rev-parse', 'main')).not.toBe(newer);
  });

  it('keeps starting from your checkout when it has commits origin does not', async () => {
    await commitFile(upstream, 'vitest.config.ts', 'export default {};\n');
    const local = await commitFile(checkout, 'mine.ts', 'mine\n');
    const { record } = await place();
    expect(record.baseCommit).toBe(local);
    expect(record.baseRef).toBe('main');
  });

  it('falls back to your checkout quietly when there is no remote to fetch', async () => {
    git(checkout, 'remote', 'remove', 'origin');
    const head = git(checkout, 'rev-parse', 'HEAD');
    const { placed, record } = await place();
    expect(placed.input.chatWorktree).toBe(true);
    expect(record.baseCommit).toBe(head);
  });

  it('brings only the chat’s own edits into a checkout that is behind origin', async () => {
    await commitFile(upstream, 'vitest.config.ts', 'export default {};\n');
    const { record } = await place();
    await writeFile(join(record.path, 'app.ts'), 'two\n');
    const outcome = await bringChanges(checkout, record.path, record.baseCommit);
    expect(outcome).toMatchObject({ status: 'applied', files: ['app.ts'] });
    expect(await readFile(join(checkout, 'app.ts'), 'utf8')).toBe('two\n');
    expect(git(checkout, 'status', '--porcelain')).toBe('M app.ts');
  });
});
