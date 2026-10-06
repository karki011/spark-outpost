import { describe, expect, it } from 'vitest';
import type { ApprovalRequest } from './decide.ts';
import { railCrossings } from './rail-crossings.ts';
import { parseShell } from './shell-parse.ts';

const ROOT = '/work/app';

function request(overrides: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title: 'ls',
    command: 'ls',
    cwd: ROOT,
    paths: [],
    diffs: [],
    options: [],
    roots: [{ path: ROOT, ignore: [] }],
    home: '/Users/me',
    ...overrides,
  };
}

const edit = (target: string) =>
  request({ kind: 'edit', toolKind: 'edit', title: 'Edit', command: null, paths: [target] });

async function run(command: string) {
  const asked = request({ command, title: command });
  return railCrossings(asked, { shell: await parseShell(command) });
}

describe('rail crossings Spark flags after an unasked action', () => {
  it('flags an edit outside the project with its path, but not one in a temp folder', async () => {
    expect(await railCrossings(edit('/Users/me/x.txt'))).toEqual([
      { rail: 'outside_write', paths: ['/Users/me/x.txt'] },
    ]);
    expect(await railCrossings(edit('/tmp/scratch.txt'))).toEqual([]);
    expect(await railCrossings(edit(`${ROOT}/src/a.ts`))).toEqual([]);
  });

  it('flags shell writes and deletes outside the project', async () => {
    expect(await run('echo hi > ~/notes.txt')).toEqual([
      { rail: 'outside_write', paths: ['/Users/me/notes.txt'] },
    ]);
    expect(await run('rm -rf /Users/me/old')).toEqual([
      { rail: 'outside_delete', paths: ['/Users/me/old'] },
    ]);
  });

  it('flags secret files, instruction files, git config and force pushes', async () => {
    expect(await run('echo x > .env')).toEqual([{ rail: 'secret', paths: ['.env'] }]);
    expect(await run('rm .env')).toEqual([{ rail: 'secret', paths: ['.env'] }]);
    expect(await railCrossings(edit(`${ROOT}/.env`))).toEqual([
      { rail: 'secret', paths: ['.env'] },
    ]);
    expect(await railCrossings(edit(`${ROOT}/AGENTS.md`))).toEqual([
      { rail: 'instructions', paths: ['AGENTS.md'] },
    ]);
    expect(await run('git config core.hooksPath /x')).toEqual([
      { rail: 'git_control', paths: ['.git/config'] },
    ]);
    expect((await run('git push --force origin spark/task')).map((found) => found.rail)).toEqual([
      'force_push',
    ]);
  });

  it('does not flag reading a secret file in the project', async () => {
    expect(await run('cat .env')).toEqual([]);
    expect(await run('grep -rn TOKEN .')).toEqual([]);
    expect(await run('cat ~/.npmrc')).toEqual([{ rail: 'secret', paths: ['.npmrc'] }]);
  });

  it('flags nothing for an ordinary command in the project', async () => {
    expect(await run('pnpm test && git status')).toEqual([]);
  });
});
