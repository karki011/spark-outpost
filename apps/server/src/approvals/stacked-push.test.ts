import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import { BUILDER_PUBLISH_REASON, NO_RUN_RULES, decide, type ApprovalRequest } from './decide.ts';
import type { FileLister } from './file-lister.ts';
import { parentNotPushedReason, type PublishGrant, type TaskBranch } from './publish-policy.ts';
import { pushesBranch, stackedPushRefusal } from './stacked-push.ts';

const ROOT = '/work/app/.spark/worktrees/chat-2';
const BRANCH = 'spark/orders-page-5e6f';
const PARENT = 'spark/orders-endpoint-1a2b';
const files: FileLister = { glob: () => [], walk: () => [], script: () => null };
const REASON = parentNotPushedReason(BRANCH, { branch: PARENT, owner: '@api' });

const stacked = (onRemote: boolean): TaskBranch => ({
  branch: BRANCH,
  protectedBranches: ['main', 'master', PARENT],
  stackBase: { branch: PARENT, owner: '@api', onRemote },
  pullBase: PARENT,
});

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

describe("pushesBranch() recognises a push of the chat's own branch", () => {
  it.each([
    `git push origin ${BRANCH}`,
    `git push -u origin ${BRANCH}`,
    `git push origin HEAD:${BRANCH}`,
    `git -C ${ROOT} push origin ${BRANCH}`,
    `pnpm test && git push origin ${BRANCH}`,
    'git push',
    'git push -u origin',
    'git push -u origin HEAD',
    'git push origin @:refs/heads/elsewhere',
  ])('%s', (command) => {
    expect(pushesBranch(command, BRANCH)).toBe(true);
  });

  it.each([
    'git push origin main',
    `git push origin ${PARENT}`,
    `git push origin --delete ${BRANCH}`,
    'git push origin :spark/old-branch',
    'git push --all origin',
    'git status',
    `git log origin/${BRANCH}`,
  ])('not %s', (command) => {
    expect(pushesBranch(command, BRANCH)).toBe(false);
  });
});

describe('stackedPushRefusal()', () => {
  const PUSH = `git push origin ${BRANCH}`;

  it("gives spark_push's reason while the parent branch is not on the remote", () => {
    expect(stackedPushRefusal(PUSH, stacked(false))).toBe(REASON);
  });

  it('says nothing once the parent is on the remote, for a chat that is not stacked, or with no branch', () => {
    expect(stackedPushRefusal(PUSH, stacked(true))).toBeNull();
    expect(stackedPushRefusal(PUSH, { branch: BRANCH, protectedBranches: ['main'] })).toBeNull();
    expect(stackedPushRefusal(PUSH, null)).toBeNull();
  });

  it('says nothing for a push of another branch or a command that does not push', () => {
    expect(stackedPushRefusal('git push origin main', stacked(false))).toBeNull();
    expect(stackedPushRefusal('gh pr create --fill', stacked(false))).toBeNull();
  });
});

describe('decide() for a raw git push of a stacked branch whose parent is not on the remote', () => {
  const ASKED: PublishGrant = { level: 'hands-off', requested: true };
  const QUIET: PublishGrant = { level: 'hands-off', requested: false };
  const FULL_AUTO: PublishGrant = { level: 'full-auto', requested: false };
  const PUSH = `git push -u origin ${BRANCH}`;
  const weigh = (posture: ModePosture, grant: PublishGrant, builder: boolean, onRemote = false) =>
    decide(posture, run(PUSH), NO_RUN_RULES, [], {
      builder,
      files,
      publish: { grant, task: stacked(onRemote) },
    });

  it.each([
    ['Manual when the message asked', 'asks', ASKED],
    ['Manual with no request, before any card', 'asks', QUIET],
    ['Accept edits at Full auto → PR', 'edits', FULL_AUTO],
    ['Auto', 'auto', QUIET],
  ] as const)('refuses the chat’s own agent in %s', (_name, posture, grant) => {
    expect(weigh(posture, grant, false)).toEqual({ verdict: 'reject', reason: REASON });
  });

  it('refuses a Builder that may publish, and keeps the Builder rule for one that may not', () => {
    expect(weigh('asks', ASKED, true)).toEqual({ verdict: 'reject', reason: REASON });
    expect(weigh('asks', QUIET, true)).toEqual({
      verdict: 'reject',
      reason: BUILDER_PUBLISH_REASON,
    });
  });

  it('decides as before once the parent branch is on the remote', () => {
    expect(weigh('asks', ASKED, false, true).verdict).toBe('allow');
    expect(weigh('asks', QUIET, false, true).verdict).toBe('ask');
    expect(weigh('auto', QUIET, false, true).verdict).toBe('allow');
  });
});
