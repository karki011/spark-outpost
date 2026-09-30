import { describe, expect, it } from 'vitest';
import {
  INSTALL_REASON,
  NO_RUN_RULES,
  PUSH_REASON,
  SAFE_READ_WHY,
  SECRET_REASON,
  WORKTREE_AUTO_WHY,
  decide,
  type ApprovalRequest,
} from './decide.ts';
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

const run = (command: string) => request({ command, title: command });
const edit = request({
  kind: 'edit',
  toolKind: 'edit',
  title: 'Edit a.ts',
  command: null,
  paths: [`${ROOT}/a.ts`],
});
const asking = (command: string) =>
  decide('read_only', run(command), NO_RUN_RULES, [], { askRun: true });

describe('decide() in an Ask run', () => {
  it('runs read-only commands without asking', () => {
    expect(asking('ls -la')).toEqual({ verdict: 'allow', by: 'level', why: SAFE_READ_WHY });
    expect(asking('git status')).toEqual({ verdict: 'allow', by: 'level', why: SAFE_READ_WHY });
  });

  it('asks before any other command', () => {
    expect(asking('curl -sI https://example.com | head -3')).toEqual({
      verdict: 'ask',
      reason: null,
    });
    expect(asking('pnpm test')).toEqual({ verdict: 'ask', reason: null });
  });

  it.each([
    'touch notes.txt',
    'echo hi > notes.txt',
    'sed -i s/a/b/ a.ts',
    'rm -rf dist',
    'mv a.ts b.ts',
    'mkdir build',
    'git commit -m wip',
    'git add .',
    'git push origin feature',
    'git push --force-with-lease origin feature',
    'pnpm add left-pad',
    'gh pr create',
  ])('refuses a command that changes files: %s', (command) => {
    expect(asking(command)).toEqual({ verdict: 'reject', reason: ASK_RUN_REASON });
  });

  it('refuses edits, moves and deletes', () => {
    const options = { askRun: true };
    expect(decide('read_only', edit, NO_RUN_RULES, [], options)).toEqual({
      verdict: 'reject',
      reason: ASK_RUN_REASON,
    });
    const deleting = { ...edit, toolKind: 'delete', kind: 'other' as const };
    expect(decide('read_only', deleting, NO_RUN_RULES, [], options).verdict).toBe('reject');
  });

  it('keeps the safety floor', () => {
    expect(asking('cat .env')).toEqual({ verdict: 'ask', reason: SECRET_REASON });
  });
});

describe("decide() with Automatic in the chat's worktree", () => {
  const auto = (target: ApprovalRequest) =>
    decide('asks', target, NO_RUN_RULES, [], { worktreeAuto: true });

  it('allows edits and commands without asking', () => {
    const allowed = { verdict: 'allow', by: 'level', why: WORKTREE_AUTO_WHY };
    expect(auto(edit)).toEqual(allowed);
    expect(auto(run('pnpm build'))).toEqual(allowed);
  });

  it('still asks for the safety floor and before pushing', () => {
    expect(auto(run('pnpm add left-pad'))).toEqual({ verdict: 'ask', reason: INSTALL_REASON });
    expect(auto(run('git push origin feature'))).toEqual({ verdict: 'ask', reason: PUSH_REASON });
  });

  it('follows the mode without it', () => {
    expect(decide('asks', run('pnpm build'), NO_RUN_RULES, [])).toEqual({
      verdict: 'ask',
      reason: null,
    });
  });
});
