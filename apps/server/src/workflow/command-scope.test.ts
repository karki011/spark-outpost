import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Queryable } from '../persistence/db.ts';
import { sparkCommandScope } from './command-scope.ts';

const RUN = '01990000-0000-7000-8000-0000000000aa';
const CHAT = '01990000-0000-7000-8000-0000000000c1';
const db = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Queryable;

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-command-scope-')));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const input = (change: Partial<Parameters<typeof sparkCommandScope>[2]> = {}) => ({
  provider: 'claude',
  agentMode: 'default',
  mode: 'do' as const,
  role: 'builder' as const,
  piece: null,
  projectRoots: [root],
  level: 'full-auto' as const,
  userRequest: 'start the dev server and push it',
  workspaceId: '01990000-0000-7000-8000-0000000000d1',
  identity: { runId: RUN, threadId: CHAT },
  ...change,
});

describe('the scope a Spark-run command is judged in', () => {
  it('carries the turn’s own mode, role, roots with their .sparkignore, and publish grant', async () => {
    await writeFile(path.join(root, '.sparkignore'), 'private/\n');
    const scope = await sparkCommandScope(db, RUN, input());
    expect(scope).toMatchObject({
      runId: RUN,
      provider: 'claude',
      agentMode: 'default',
      runMode: 'do',
      role: 'builder',
      piece: null,
      readOnly: false,
      roots: [{ path: root, ignore: ['private/'] }],
      publish: { level: 'full-auto', requested: true, followUp: null },
    });
  });

  it('marks an assistant turn read-only and keeps a piece’s guard', async () => {
    const piece = { coordinated: true, owned: null };
    const scope = await sparkCommandScope(db, RUN, input({ assistant: true, piece }));
    expect(scope).toMatchObject({ readOnly: true, piece });
  });

  it('has no roots when the chat has no folder or the folder is gone', async () => {
    expect((await sparkCommandScope(db, RUN, input({ projectRoots: [] }))).roots).toEqual([]);
    const gone = path.join(root, 'missing');
    expect((await sparkCommandScope(db, RUN, input({ projectRoots: [gone] }))).roots).toEqual([]);
  });
});
