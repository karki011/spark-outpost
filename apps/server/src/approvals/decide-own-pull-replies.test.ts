import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import {
  CHAT_PUBLISH_REASON,
  NO_RUN_RULES,
  PUBLISH_FOLLOW_UP_WHY,
  decide,
  type ApprovalRequest,
  type Decision,
} from './decide.ts';
import type { FileLister } from './file-lister.ts';
import type { OwnRepo } from './own-repo.ts';
import { ghRailReason, type PublishGrant, type TaskBranch } from './publish-policy.ts';

const ROOT = '/work/app/.spark/worktrees/chat-1';
const BRANCH = 'spark/fix-dates-1a2b';
const TASK: TaskBranch = { branch: BRANCH, protectedBranches: ['main', 'master'], pull: 12 };
const files: FileLister = { glob: () => [], walk: () => [], script: () => null };
const FOLLOWED: OwnRepo = { host: 'github.com', slug: 'acme/app', branch: BRANCH, pull: 12 };
const NOT_FOLLOWED: OwnRepo = { ...FOLLOWED, pull: null };
const ROUND: PublishGrant = {
  level: 'hands-off',
  requested: false,
  followUp: { workspaceId: 'w1', conversationId: 'c1' },
};
const ORDINARY: PublishGrant = { level: 'hands-off', requested: false };
const FULL_AUTO: PublishGrant = { level: 'full-auto', requested: false };
const GRANTS = [ROUND, ORDINARY, FULL_AUTO];
const POSTURES: readonly ModePosture[] = ['asks', 'edits', 'auto', 'full_access'];

const graphql = (mutation: string) => `gh api graphql -f query='mutation { ${mutation} }'`;
const THREAD_REPLY = graphql(
  'addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: "PRRT_x", body: "Fixed"}) { comment { id } }',
);
const RESOLVE = graphql('resolveReviewThread(input: {threadId: "PRRT_x"}) { thread { id } }');

const OWN_REPLIES: readonly (readonly [string, string])[] = [
  ['gh pr comment 12 --body "Fixed in abc123"', 'gh pr comment'],
  ['gh pr comment --body "Fixed in abc123"', 'gh pr comment'],
  [`gh pr comment ${BRANCH} --body "Not changed: the date is UTC"`, 'gh pr comment'],
  ['gh api repos/acme/app/pulls/12/comments/55/replies -f body="Fixed in abc123"', 'gh api'],
  ['gh api -X POST repos/{owner}/{repo}/pulls/comments/55/replies -f body=Fixed', 'gh api'],
  ['gh api repos/acme/app/issues/12/comments -f body="Answer: it is UTC"', 'gh api'],
  [THREAD_REPLY, 'gh api'],
  [RESOLVE, 'gh api'],
];

const ELSEWHERE: readonly (readonly [string, string])[] = [
  ['gh pr comment 77 --body "Fixed"', 'gh pr comment'],
  ['gh pr comment 12 --repo other/repo --body "Fixed"', 'gh pr comment'],
  ['gh pr comment https://github.com/other/repo/pull/12 --body "Fixed"', 'gh pr comment'],
  ['GH_REPO=other/repo gh pr comment 12 --body "Fixed"', 'gh pr comment'],
  ['gh pr comment 12 --delete-last --yes', 'gh pr comment'],
  ['gh api repos/acme/app/pulls/77/comments/55/replies -f body=Fixed', 'gh api'],
  ['gh api repos/other/repo/pulls/12/comments/55/replies -f body=Fixed', 'gh api'],
  ['gh api repos/acme/app/issues/77/comments -f body=Fixed', 'gh api'],
  ['gh api graphql --input reply.json', 'gh api'],
  ['gh issue comment 12 --body "Fixed"', 'gh issue comment'],
];

const NEVER: readonly (readonly [string, string])[] = [
  ['gh pr merge 12 --squash', 'gh pr merge'],
  ['gh pr review 12 --approve', 'gh pr review'],
  ['gh pr review 12 --request-changes --body no', 'gh pr review'],
  ['gh pr review 12 --comment --body "Looks fine"', 'gh pr review'],
  ['gh pr close 12', 'gh pr close'],
  ['gh pr reopen 12', 'gh pr reopen'],
  ['gh pr ready 12', 'gh pr ready'],
  ['gh api -X PUT repos/acme/app/pulls/12/merge', 'gh api'],
  ['gh api -X PUT repos/acme/app/pulls/12/reviews/9/dismissals -f message=x', 'gh api'],
  ['gh api -X PATCH repos/acme/app/pulls/12 -f state=closed', 'gh api'],
  ['gh api -X DELETE repos/acme/app/pulls/comments/55', 'gh api'],
  [graphql('mergePullRequest(input: {pullRequestId: "PR_x"}) { clientMutationId }'), 'gh api'],
  [
    graphql(
      'dismissPullRequestReview(input: {pullRequestReviewId: "PRR_x", message: "x"}) { clientMutationId }',
    ),
    'gh api',
  ],
  [graphql('closePullRequest(input: {pullRequestId: "PR_x"}) { clientMutationId }'), 'gh api'],
  [
    graphql(
      'resolveReviewThread(input: {threadId: "PRRT_x"}) { thread { id } } mergePullRequest(input: {pullRequestId: "PR_x"}) { clientMutationId }',
    ),
    'gh api',
  ],
];

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

function chatRun(
  posture: ModePosture,
  grant: PublishGrant,
  command: string,
  own: OwnRepo | null,
): Decision {
  return decide(posture, run(command), NO_RUN_RULES, [], {
    changesProject: true,
    files,
    own,
    publish: { grant, task: TASK },
  });
}

const basisFor = (posture: ModePosture, grant: PublishGrant) =>
  grant !== ORDINARY || posture === 'auto' || posture === 'full_access';

function refusedByName(
  decision: Decision,
  posture: ModePosture,
  grant: PublishGrant,
  named: string,
) {
  expect(decision).toEqual({
    verdict: 'reject',
    reason: basisFor(posture, grant) ? ghRailReason(named) : CHAT_PUBLISH_REASON,
  });
}

describe("a reply on the chat's own open pull request while follow-up is on", () => {
  it.each(OWN_REPLIES)("follows the agent's mode in a round and outside one: %s", (command) => {
    for (const grant of GRANTS) {
      for (const posture of ['asks', 'edits'] as const) {
        expect(chatRun(posture, grant, command, FOLLOWED), posture).toEqual({
          verdict: 'ask',
          reason: null,
        });
      }
      for (const posture of ['auto', 'full_access'] as const) {
        expect(chatRun(posture, grant, command, FOLLOWED), posture).toEqual({
          verdict: 'allow',
          by: 'level',
        });
      }
    }
  });

  it("is refused in Don't ask like any command that is not pre-approved", () => {
    expect(chatRun('denies', ROUND, OWN_REPLIES[0]![0], FOLLOWED).verdict).toBe('reject');
  });

  it.each(OWN_REPLIES)(
    'is refused by name when follow-up is off or asks first: %s',
    (command, named) => {
      for (const own of [NOT_FOLLOWED, null]) {
        for (const grant of GRANTS) {
          for (const posture of POSTURES) {
            refusedByName(chatRun(posture, grant, command, own), posture, grant, named);
          }
        }
      }
    },
  );
});

describe('a comment or reply anywhere else', () => {
  it.each(ELSEWHERE)('is refused by name with follow-up on or off: %s', (command, named) => {
    for (const own of [FOLLOWED, NOT_FOLLOWED]) {
      for (const grant of GRANTS) {
        for (const posture of POSTURES) {
          refusedByName(chatRun(posture, grant, command, own), posture, grant, named);
        }
      }
    }
  });
});

describe('merging, reviewing, dismissing, closing and reopening', () => {
  it.each(NEVER)('is refused by name on the own pull request: %s', (command, named) => {
    for (const own of [FOLLOWED, NOT_FOLLOWED]) {
      for (const grant of GRANTS) {
        for (const posture of POSTURES) {
          refusedByName(chatRun(posture, grant, command, own), posture, grant, named);
        }
      }
    }
  });
});

describe('a follow-up fix pushed with a reply', () => {
  const push = `git push origin ${BRANCH}`;

  it('pushes in a round without a card, in every mode', () => {
    for (const posture of ['asks', 'edits'] as const) {
      expect(chatRun(posture, ROUND, push, FOLLOWED)).toEqual({
        verdict: 'allow',
        by: 'level',
        why: PUBLISH_FOLLOW_UP_WHY,
      });
    }
  });

  it('does not push outside a round because follow-up is on', () => {
    for (const posture of ['asks', 'edits'] as const) {
      expect(chatRun(posture, ORDINARY, push, FOLLOWED)).toEqual({
        verdict: 'reject',
        reason: CHAT_PUBLISH_REASON,
      });
    }
  });

  it('judges a push and a reply in one command by the push', () => {
    const both = `${push} && gh pr comment 12 --body "Fixed"`;
    expect(chatRun('asks', ROUND, both, FOLLOWED)).toEqual({
      verdict: 'allow',
      by: 'level',
      why: PUBLISH_FOLLOW_UP_WHY,
    });
    expect(chatRun('asks', ORDINARY, both, FOLLOWED)).toEqual({
      verdict: 'reject',
      reason: CHAT_PUBLISH_REASON,
    });
    expect(chatRun('asks', ROUND, `${push} && gh pr comment 77 --body "Fixed"`, FOLLOWED)).toEqual({
      verdict: 'reject',
      reason: ghRailReason('gh pr comment'),
    });
  });
});
