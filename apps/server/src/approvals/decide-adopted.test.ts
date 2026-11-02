import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import { NO_RUN_RULES, decide, type ApprovalRequest } from './decide.ts';
import type { FileLister } from './file-lister.ts';
import { PLAIN_FORCE_REASON } from './git-commands.ts';
import {
  adoptedForceReason,
  otherBranchReason,
  type PublishGrant,
  type TaskBranch,
} from './publish-policy.ts';

const ROOT = '/work/app/.spark/worktrees/chat-1';
const HEAD = 'alice/fix-dates';
const ADOPTED: TaskBranch = {
  branch: HEAD,
  protectedBranches: ['main', 'master', 'develop'],
  pull: 12,
  adopted: { author: 'alice', pull: 12 },
};
const files: FileLister = { glob: () => [], walk: () => [], script: () => null };
const MANUAL: PublishGrant = { level: 'hands-off', requested: false };
const ASKED: PublishGrant = { level: 'hands-off', requested: true };
const ROUND: PublishGrant = {
  level: 'hands-off',
  requested: false,
  followUp: { workspaceId: 'w1', conversationId: 'c1' },
};

function run(command: string): ApprovalRequest {
  return {
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
}

function chat(posture: ModePosture, command: string, grant = MANUAL, task = ADOPTED) {
  return decide(posture, run(command), NO_RUN_RULES, [], {
    changesProject: true,
    files,
    defaultBranch: 'main',
    publish: { grant, task },
  });
}

describe('a pull request branch the user adopted', () => {
  it.each([
    `git push origin ${HEAD}`,
    `git push pr-alice ${HEAD}`,
    `git push -u origin HEAD:${HEAD}`,
  ])('is pushed like the chat own branch: %s', (command) => {
    expect(chat('full_access', command)).toEqual({ verdict: 'allow', by: 'level' });
    expect(chat('asks', command, ASKED).verdict).toBe('allow');
    expect(chat('asks', command, ROUND).verdict).toBe('allow');
  });

  it('is refused without a publish basis, like any chat branch', () => {
    expect(chat('asks', `git push origin ${HEAD}`).verdict).toBe('reject');
  });

  it('is never force pushed, not even with a lease', () => {
    expect(chat('full_access', `git push --force-with-lease origin ${HEAD}`)).toEqual({
      verdict: 'reject',
      reason: adoptedForceReason(HEAD, { author: 'alice', pull: 12 }),
    });
    expect(chat('full_access', `git push --force origin ${HEAD}`)).toEqual({
      verdict: 'reject',
      reason: PLAIN_FORCE_REASON,
    });
  });

  it.each(['main', 'develop', 'spark/other-1a2b'])('does not open a push to %s', (branch) => {
    expect(chat('full_access', `git push origin ${branch}`)).toEqual({
      verdict: 'reject',
      reason: otherBranchReason(HEAD),
    });
  });

  it('keeps the default branch refused even when it is the head', () => {
    const task = { ...ADOPTED, branch: 'main' };
    expect(chat('full_access', 'git push origin main', MANUAL, task)).toEqual({
      verdict: 'reject',
      reason: otherBranchReason('main'),
    });
  });

  it('lets the agent edit and comment on the adopted pull request by number', () => {
    expect(chat('full_access', 'gh pr edit 12 --add-label ready')).toEqual({
      verdict: 'allow',
      by: 'level',
    });
  });
});
