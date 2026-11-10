import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import { NO_SPARK_RULES } from '../spark-rules/resolve.ts';
import { NO_RUN_RULES, decide, type ApprovalRequest, type Decision } from './decide.ts';
import { PUBLISH_FOLLOW_UP_WHY, REREQUEST_REVIEW_WHY } from './decide-publish.ts';
import type { FileLister } from './file-lister.ts';
import { DEFAULT_RULE_CONTEXT } from './gh-rules.ts';
import { ownGhUse, reviewRequestOf, type OwnRepo } from './own-repo.ts';
import type { PublishGrant, TaskBranch } from './publish-policy.ts';

const ROOT = '/work/app/.spark/worktrees/chat-1';
const BRANCH = 'spark/fix-dates-1a2b';
const TASK: TaskBranch = { branch: BRANCH, protectedBranches: ['main', 'master'], pull: 12 };
const files: FileLister = { glob: () => [], walk: () => [], script: () => null };
const REVIEWERS = ['alice', 'acme/core', 'coderabbitai[bot]', 'copilot-pull-request-reviewer[bot]'];
const FOLLOWED: OwnRepo = {
  host: 'github.com',
  slug: 'acme/app',
  branch: BRANCH,
  pull: 12,
  reviewers: REVIEWERS,
};
const NOT_FOLLOWED: OwnRepo = { ...FOLLOWED, pull: null };
const ROUND: PublishGrant = {
  level: 'hands-off',
  requested: false,
  followUp: { workspaceId: 'w1', conversationId: 'c1' },
};
const ORDINARY: PublishGrant = { level: 'hands-off', requested: false };
const ASKING: readonly ModePosture[] = ['asks', 'edits'];

const EXISTING = [
  'gh pr edit 12 --add-reviewer alice',
  'gh pr edit 12 --add-reviewer @alice,acme/core',
  'gh pr edit --add-reviewer=coderabbitai[bot]',
  `gh pr edit ${BRANCH} --add-reviewer alice --add-reviewer copilot`,
  "gh api repos/acme/app/pulls/12/requested_reviewers -f 'reviewers[]=alice'",
  "gh api -X POST repos/{owner}/{repo}/pulls/12/requested_reviewers -f 'team_reviewers[]=core'",
];

const NEW_REVIEWER = [
  'gh pr edit 12 --add-reviewer mallory',
  'gh pr edit 12 --add-reviewer alice,mallory',
  'gh pr edit 12 --add-reviewer coderabbitai',
  "gh api repos/acme/app/pulls/12/requested_reviewers -f 'reviewers[]=mallory'",
  "gh api repos/acme/app/pulls/12/requested_reviewers -f 'team_reviewers[]=everyone'",
];

const OTHER_PULL = [
  'gh pr edit 77 --add-reviewer alice',
  'gh pr edit 12 --repo other/app --add-reviewer alice',
  'gh pr edit https://github.com/other/app/pull/12 --add-reviewer alice',
  "gh api repos/acme/app/pulls/77/requested_reviewers -f 'reviewers[]=alice'",
  "gh api repos/other/app/pulls/12/requested_reviewers -f 'reviewers[]=alice'",
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
  rules = DEFAULT_RULE_CONTEXT,
): Decision {
  return decide(posture, run(command), NO_RUN_RULES, [], {
    changesProject: true,
    files,
    own,
    publish: { grant, task: TASK },
    sparkRules: rules,
  });
}

describe('re-requesting review in a follow-up round', () => {
  it.each(EXISTING)('is allowed for reviewers already on the own pull request: %s', (command) => {
    for (const posture of ASKING) {
      expect(chatRun(posture, ROUND, command, FOLLOWED)).toEqual({
        verdict: 'allow',
        by: 'level',
        why: REREQUEST_REVIEW_WHY,
      });
    }
  });

  it.each(NEW_REVIEWER)('is refused for a reviewer who is new: %s', (command) => {
    for (const posture of ASKING) {
      const decision = chatRun(posture, ROUND, command, FOLLOWED);
      expect(decision.verdict).toBe('reject');
      expect(decision.verdict === 'reject' && decision.reason).toMatch(
        /re-requests review only from reviewers already on pull request #12 \(alice, acme\/core/,
      );
    }
  });

  it.each(OTHER_PULL)('is refused on another pull request: %s', (command) => {
    const decision = chatRun('asks', ROUND, command, FOLLOWED);
    expect(decision.verdict).toBe('reject');
  });

  it('is refused while follow-up is off or asks first', () => {
    for (const command of [EXISTING[0]!, EXISTING[4]!]) {
      const decision = chatRun('asks', ROUND, command, NOT_FOLLOWED);
      expect(decision.verdict).toBe('reject');
      expect(decision.verdict === 'reject' && decision.reason).toContain(
        "only on this chat's own open pull request while Follow up on pull requests is on",
      );
    }
  });

  it('is refused outside a round under the recommended rules', () => {
    expect(chatRun('asks', ORDINARY, EXISTING[0]!, FOLLOWED).verdict).toBe('reject');
    expect(chatRun('asks', ORDINARY, EXISTING[4]!, FOLLOWED).verdict).toBe('reject');
  });

  it('keeps Gh(api write) for other API writes in a round', () => {
    const removal =
      "gh api -X DELETE repos/acme/app/pulls/12/requested_reviewers -f 'reviewers[]=alice'";
    const extra = 'gh api repos/acme/app/pulls/12/requested_reviewers --input body.json';
    expect(chatRun('asks', ROUND, removal, FOLLOWED).verdict).toBe('reject');
    expect(chatRun('asks', ROUND, extra, FOLLOWED).verdict).toBe('reject');
  });

  it('leaves a new reviewer to the agent mode when no Spark rule is set', () => {
    const none = { rules: NO_SPARK_RULES, once: [] };
    expect(chatRun('asks', ROUND, NEW_REVIEWER[0]!, FOLLOWED, none).verdict).toBe('ask');
  });

  it('treats an allowed re-request as work on the own pull request, not a send', () => {
    const words = (command: string) => command.replaceAll("'", '').split(' ').slice(1);
    expect(ownGhUse(words(EXISTING[4]!), FOLLOWED)).toBe(true);
    expect(ownGhUse(words(NEW_REVIEWER[3]!), FOLLOWED)).toBe(false);
  });

  it('judges only reviewer requests', () => {
    expect(reviewRequestOf(['pr', 'edit', '12', '--title', 'x'], FOLLOWED)).toBeNull();
    expect(reviewRequestOf(['pr', 'comment', '12', '--body', 'x'], FOLLOWED)).toBeNull();
  });
});

describe('updating the branch in a follow-up round', () => {
  const merged = `git fetch origin main && git merge origin/main && git push origin ${BRANCH}`;

  it('pushes a merge of the base to the own branch under follow-up', () => {
    for (const posture of ASKING) {
      expect(chatRun(posture, ROUND, `git push origin ${BRANCH}`, FOLLOWED)).toEqual({
        verdict: 'allow',
        by: 'level',
        why: PUBLISH_FOLLOW_UP_WHY,
      });
    }
    expect(chatRun('edits', ROUND, merged, FOLLOWED).verdict).not.toBe('reject');
  });

  it.each([
    `git push --force origin ${BRANCH}`,
    `git push -f origin ${BRANCH}`,
    `git push origin +${BRANCH}`,
  ])('refuses a plain force push of a rebased branch while Push(force) is set: %s', (command) => {
    for (const posture of ASKING) {
      expect(chatRun(posture, ROUND, command, FOLLOWED).verdict).toBe('reject');
    }
  });

  it('asks with hold-to-confirm before a lease force push while Push(force) asks', () => {
    const command = `git push --force-with-lease origin ${BRANCH}`;
    const decision = chatRun('asks', ROUND, command, FOLLOWED);
    expect(decision.verdict).toBe('ask');
    expect(decision.verdict === 'ask' && decision.forcePush).toEqual([BRANCH]);
  });

  it('refuses a lease force push while Push(force) is denied', () => {
    const denied = {
      rules: { ...NO_SPARK_RULES, user: { allow: [], ask: [], deny: ['Push(force)'] } },
      once: [],
    };
    const command = `git push --force-with-lease origin ${BRANCH}`;
    expect(chatRun('asks', ROUND, command, FOLLOWED, denied).verdict).toBe('reject');
  });
});
