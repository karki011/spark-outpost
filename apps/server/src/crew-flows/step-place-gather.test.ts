import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Queryable } from '../persistence/db.ts';
import type { RunInput } from '../workflow/run-input.ts';
import type { TurnWorkflowRun } from './run-records.ts';
import { stepPlaceFor } from './step-place-gather.ts';

let root: string;

const git = (...args: string[]) =>
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'T',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 'T',
      GIT_COMMITTER_EMAIL: 't@example.com',
    },
  }).trim();

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-step-place-')));
  git('init', '-q', '-b', 'main');
  await writeFile(path.join(root, 'a.ts'), 'one\n');
  git('add', '.');
  git('commit', '-q', '-m', 'Start');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const noRows = { query: async () => ({ rows: [] }) } as unknown as Queryable;
const failing = {
  query: async () => {
    throw new Error('down');
  },
} as unknown as Queryable;

function turn(source: TurnWorkflowRun['run']['source'] = 'manual'): TurnWorkflowRun {
  return {
    run: { id: 'r1', kind: 'run', source, conversationId: 'c1' },
    workflow: { id: 'nightly' },
    message: '',
    continues: false,
    edits: false,
    triggerKind: null,
  } as unknown as TurnWorkflowRun;
}

const input = (roots: string[], chatFolder = false) =>
  ({ workspaceId: 'w1', projectRoots: roots, chatFolder }) as unknown as RunInput;

describe('stepPlaceFor', () => {
  it('lists the branch’s committed, uncommitted and new files against the default branch', async () => {
    git('checkout', '-q', '-b', 'spark/work');
    await writeFile(path.join(root, 'b.ts'), 'two\nthree\n');
    git('add', '.');
    git('commit', '-q', '-m', 'Add b');
    await writeFile(path.join(root, 'a.ts'), 'uno\n');
    await writeFile(path.join(root, 'c.ts'), 'new\n');

    const block = (await stepPlaceFor({ db: noRows, input: input([root]), turn: turn() }))!;

    expect(block).toContain(`Project: ${path.basename(root)}`);
    expect(block).toContain('Branch: spark/work, compared with main');
    expect(block).toContain('- a.ts (+1 -1)');
    expect(block).toContain('- b.ts (+2 -0)');
    expect(block).toContain('- c.ts (new, not yet added to git)');
    expect(block).not.toContain(root);
  });

  it('lists the base branch’s recent commits on a first scheduled run', async () => {
    await writeFile(path.join(root, 'a.ts'), 'two\n');
    git('commit', '-q', '-am', 'Second change');

    const block = (await stepPlaceFor({
      db: noRows,
      input: input([root]),
      turn: turn('schedule'),
    }))!;

    expect(block).toContain('Changed files compared with main: none.');
    expect(block).toMatch(/- [0-9a-f]{7,} Second change/);
    expect(block).toContain('since there is no earlier successful scheduled run (2):');
  });

  it('omits what it cannot read and still gives the rest', async () => {
    const block = (await stepPlaceFor({
      db: failing,
      input: input([root]),
      turn: turn('schedule'),
    }))!;

    expect(block).toContain('Branch: main');
    expect(block).not.toContain('open pull request');
    expect(block).toContain('Commits on main');
  });

  it('names a folder that is not a git repository, and nothing else', async () => {
    const plain = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-step-plain-')));
    try {
      const block = (await stepPlaceFor({ db: noRows, input: input([plain]), turn: turn() }))!;
      expect(block).toContain(`Project: ${path.basename(plain)}`);
      expect(block).not.toContain('Branch:');
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });

  it('gives no block without a project folder or for a review', async () => {
    expect(await stepPlaceFor({ db: noRows, input: input([]), turn: turn() })).toBeNull();
    expect(await stepPlaceFor({ db: noRows, input: input([root], true), turn: turn() })).toBeNull();
    const review = turn();
    review.run.kind = 'review';
    expect(await stepPlaceFor({ db: noRows, input: input([root]), turn: review })).toBeNull();
  });
});
