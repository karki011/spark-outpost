import { describe, expect, it } from 'vitest';
import { CHAT_PUBLISH_REASON, decide, NO_RUN_RULES, type ApprovalRequest } from './decide.ts';
import type { FileLister } from './file-lister.ts';
import { ghArgs, ghOnlyReads } from './gh-reads.ts';
import { sparkRuleReason } from './gh-rules.ts';
import { ghRailReason, type PublishGrant } from './publish-policy.ts';

const ROOT = '/work/app/.spark/worktrees/chat-1';
const BRANCH = 'spark/fix-dates-1a2b';
const files: FileLister = { glob: () => [], walk: () => [], script: () => null };
const UNASKED: PublishGrant = { level: 'hands-off', requested: false };
const ASKED: PublishGrant = { level: 'hands-off', requested: true };

function chat(command: string, grant: PublishGrant) {
  const request: ApprovalRequest = {
    toolCallId: 't1',
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title: command,
    command,
    cwd: ROOT,
    paths: [],
    diffs: [],
    options: [],
    roots: [{ path: ROOT, ignore: [] }],
    home: '/Users/me',
  };
  return decide('asks', request, NO_RUN_RULES, [], {
    changesProject: true,
    files,
    browserData: null,
    publish: { grant, task: { branch: BRANCH, protectedBranches: ['main'], pull: 12 } },
  });
}

describe('gh flags before the command group', () => {
  it('moves -R, --repo and --hostname with their values after the command', () => {
    expect(ghArgs(['-R', 'o/r', 'pr', 'checks', '512'])).toEqual([
      'pr',
      'checks',
      '512',
      '-R',
      'o/r',
    ]);
    expect(ghArgs(['--repo=o/r', '--hostname', 'h', 'pr', 'view'])).toEqual([
      'pr',
      'view',
      '--repo=o/r',
      '--hostname',
      'h',
    ]);
    expect(ghArgs(['-Ro/r', 'run', 'list'])).toEqual(['run', 'list', '-Ro/r']);
    expect(ghArgs(['pr', 'view', '-R', 'o/r'])).toEqual(['pr', 'view', '-R', 'o/r']);
  });

  it.each([
    ['-R', 'o/r', 'pr', 'checks', '512'],
    ['--repo', 'o/r', 'pr', 'view', '7'],
    ['--hostname=ghe.example.com', 'run', 'list'],
  ])('still reads: gh %s %s %s', (...args) => {
    expect(ghOnlyReads(args)).toBe(true);
  });

  it('lets a pull request read in another repo follow the mode instead of the publish rule', () => {
    for (const command of ['gh -R owner/repo pr checks 512', 'gh --repo owner/repo pr view 3']) {
      expect(chat(command, UNASKED).verdict, command).not.toBe('reject');
    }
  });

  it('still refuses opening a pull request in another repo', () => {
    expect(chat('gh -R owner/repo pr create --fill', UNASKED)).toEqual({
      verdict: 'reject',
      reason: CHAT_PUBLISH_REASON,
    });
    expect(chat('gh -R owner/repo pr create --fill', ASKED)).toEqual({
      verdict: 'reject',
      reason: ghRailReason('gh pr create'),
    });
  });

  it('names the real command in the Spark rules card', () => {
    const rule = { group: 'other' as const, prefix: 'gh release create' };
    expect(chat('gh -R owner/repo release create v1', UNASKED)).toEqual({
      verdict: 'reject',
      reason: sparkRuleReason(rule),
      sparkRule: rule,
    });
  });
});
