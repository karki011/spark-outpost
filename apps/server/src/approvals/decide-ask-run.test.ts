import { describe, expect, it } from 'vitest';
import {
  ASK_AUTO_WHY,
  ASK_TURN_ASKS,
  NO_RUN_RULES,
  SAFE_READ_WHY,
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
const LISTED_READ = {
  ...run('cat private/notes.md'),
  roots: [{ path: ROOT, ignore: ['private/'] }],
};
const asking = (command: string) =>
  decide('read_only', run(command), NO_RUN_RULES, [], { askRun: true });

describe('decide() in an Ask run', () => {
  it('runs read-only commands without asking', () => {
    expect(asking('ls -la')).toEqual({ verdict: 'allow', by: 'level', why: SAFE_READ_WHY });
    expect(asking('git status')).toEqual({ verdict: 'allow', by: 'level', why: SAFE_READ_WHY });
  });

  it('asks before any other command and says why', () => {
    const asked = { verdict: 'ask', reason: null, because: ASK_TURN_ASKS };
    expect(asking('curl -sI https://example.com | head -3')).toEqual(asked);
    expect(asking('pnpm test')).toEqual(asked);
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
    expect(decide('read_only', LISTED_READ, NO_RUN_RULES, [], { askRun: true })).toMatchObject({
      verdict: 'ask',
      secretFiles: expect.any(Array),
    });
  });

  it('reads a secret file in the project like any other file', () => {
    expect(asking('cat .env')).toEqual({ verdict: 'allow', by: 'level', why: SAFE_READ_WHY });
  });
});

const REPORTED_READS = [
  'ls .claude/skills/ 2>/dev/null; ls libs/features/budgets libs/features/budgets/src',
  "wc -l docs/project/ARCHITECTURE.md && grep -n '^#' docs/project/ARCHITECTURE.md",
  'ls apps libs libs/* | head -80',
];

describe('decide() in an Ask run at Automatic and Full auto', () => {
  const automatic = (command: string) =>
    decide('read_only', run(command), NO_RUN_RULES, [], {
      askRun: true,
      askAutoWhy: ASK_AUTO_WHY,
    });

  it('runs other commands without asking', () => {
    const allowed = { verdict: 'allow', by: 'level', why: ASK_AUTO_WHY };
    expect(automatic('curl -sI https://example.com')).toEqual(allowed);
    expect(automatic('pnpm test')).toEqual(allowed);
  });

  it('still refuses commands that change files', () => {
    expect(automatic('rm x')).toEqual({ verdict: 'reject', reason: ASK_RUN_REASON });
    expect(automatic('git push origin feature')).toEqual({
      verdict: 'reject',
      reason: ASK_RUN_REASON,
    });
  });

  it('keeps the safety floor', () => {
    const options = { askRun: true, askAutoWhy: ASK_AUTO_WHY };
    expect(decide('read_only', LISTED_READ, NO_RUN_RULES, [], options)).toMatchObject({
      verdict: 'ask',
      secretFiles: expect.any(Array),
    });
  });

  it('still runs read-only commands as safe reads', () => {
    expect(automatic('git status')).toEqual({ verdict: 'allow', by: 'level', why: SAFE_READ_WHY });
  });

  it("names the agent's mode when that is what lets the command run", () => {
    const options = { askRun: true, askAutoWhy: 'Auto mode' };
    expect(decide('read_only', run('pnpm test'), NO_RUN_RULES, [], options)).toEqual({
      verdict: 'allow',
      by: 'level',
      why: 'Auto mode',
    });
  });
});

describe('decide() in an Ask run without auto-allow', () => {
  it('asks before a command that is not a safe read', () => {
    expect(asking('curl -sI https://example.com')).toEqual({
      verdict: 'ask',
      reason: null,
      because: ASK_TURN_ASKS,
    });
  });

  it.each(REPORTED_READS)('runs the read-only compound command %s', (command) => {
    expect(asking(command)).toEqual({ verdict: 'allow', by: 'level', why: SAFE_READ_WHY });
  });
});
