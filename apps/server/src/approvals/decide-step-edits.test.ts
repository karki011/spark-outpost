import { describe, expect, it } from 'vitest';
import { ASK_AUTO_WHY, NO_RUN_RULES, decide, type ApprovalRequest } from './decide.ts';
import { ASK_RUN_REASON } from './ask-run.ts';

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

const edit = (target: string, toolKind = 'edit') =>
  request({ kind: 'edit', toolKind, title: `Edit ${target}`, command: null, paths: [target] });
const run = (command: string) => request({ command, title: command });

const auto = { askRun: true, askEdits: true, askAutoWhy: ASK_AUTO_WHY };
const manual = { askRun: true, askEdits: true, askAutoWhy: null };

describe('decide() for a workflow step that may change files', () => {
  it('lets an edit inside the project follow the step’s mode', () => {
    expect(decide('read_only', edit(`${ROOT}/src/a.ts`), NO_RUN_RULES, [], auto)).toEqual({
      verdict: 'allow',
      by: 'level',
      why: ASK_AUTO_WHY,
    });
    expect(decide('read_only', edit(`${ROOT}/src/a.ts`), NO_RUN_RULES, [], manual)).toMatchObject({
      verdict: 'ask',
    });
  });

  it('refuses edits outside the project, moves and deletes', () => {
    for (const asked of [
      edit('/work/other/a.ts'),
      edit(`${ROOT}/a.ts`, 'move'),
      edit(`${ROOT}/a.ts`, 'delete'),
    ]) {
      expect(decide('read_only', asked, NO_RUN_RULES, [], auto)).toMatchObject({
        verdict: 'reject',
        reason: ASK_RUN_REASON,
      });
    }
  });

  it.each([
    'git commit -am "fix"',
    'git push origin spark/fix',
    'git stash',
    'gh pr create --fill',
    'pnpm add left-pad',
    'echo hi > notes.txt',
    'rm notes.txt',
  ])('still refuses %s', (command) => {
    expect(decide('read_only', run(command), NO_RUN_RULES, [], auto)).toMatchObject({
      verdict: 'reject',
    });
  });

  it('keeps edits refused for a step without the option', () => {
    expect(
      decide('read_only', edit(`${ROOT}/a.ts`), NO_RUN_RULES, [], {
        askRun: true,
        askAutoWhy: ASK_AUTO_WHY,
      }),
    ).toMatchObject({ verdict: 'reject', reason: ASK_RUN_REASON });
  });
});
