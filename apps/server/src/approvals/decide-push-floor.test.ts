import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import {
  CHAT_PUBLISH_REASON,
  NO_RUN_RULES,
  PUBLISH_ASKED_WHY,
  PUBLISH_FULL_AUTO_WHY,
  decide,
  forcePushReason,
  type ApprovalRequest,
  type DecideOptions,
  type Decision,
} from './decide.ts';
import type { FileLister } from './file-lister.ts';
import { PLAIN_FORCE_REASON } from './git-commands.ts';
import {
  NO_TASK_BRANCH_REASON,
  REMOTE_RAIL_REASON,
  ghRailReason,
  otherBranchPushes,
  otherBranchReason,
  type PublishGrant,
  type TaskBranch,
} from './publish-policy.ts';

const ROOT = '/work/app/.spark/worktrees/chat-1';
const BRANCH = 'spark/fix-dates-1a2b';
const TASK: TaskBranch = { branch: BRANCH, protectedBranches: ['main', 'master'], pull: 12 };
const files: FileLister = { glob: () => [], walk: () => [], script: () => null };
const NOT_ASKED: PublishGrant = { level: 'hands-off', requested: false };
const ASKED: PublishGrant = { level: 'hands-off', requested: true };
const FULL_AUTO: PublishGrant = { level: 'full-auto', requested: false };
const GRANTS = [NOT_ASKED, ASKED, FULL_AUTO];
const POSTURES: ModePosture[] = ['asks', 'edits', 'auto', 'full_access', 'read_only', 'unknown'];

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

function decideFor(
  posture: ModePosture,
  grant: PublishGrant,
  command: string,
  task: TaskBranch | null = TASK,
): Decision {
  const options: DecideOptions = { changesProject: true, files, publish: { grant, task } };
  return decide(posture, run(command), NO_RUN_RULES, [command, 'git', 'gh'], options);
}

function everyDecision(command: string): Decision[] {
  return POSTURES.flatMap((posture) => GRANTS.map((grant) => decideFor(posture, grant, command)));
}

function permitted(posture: ModePosture, grant: PublishGrant): boolean {
  return grant !== NOT_ASKED || posture === 'auto' || posture === 'full_access';
}

describe('the push rules of the safety floor for the chat’s run', () => {
  it.each([
    'git push origin main',
    'git push origin some-other-branch',
    'git push origin spark/another-chat',
    `git push origin ${BRANCH} main`,
    `git push --force origin ${BRANCH}`,
    `git push origin +${BRANCH}`,
    'git push --mirror origin',
    'git push --all origin',
    `git push https://github.com/acme/app.git ${BRANCH}`,
    'git remote add fork https://example.net/fork.git',
    'git remote set-url origin https://example.net/other.git',
    'gh pr create --head some-other-branch --fill',
    'gh pr edit 77 --title x',
    'git send-email HEAD~1',
    'sh -c "git push origin main"',
  ])('refuses in every mode and at every level: %s', (command) => {
    for (const decision of everyDecision(command)) {
      expect(decision.verdict, command).toBe('reject');
    }
  });

  it('names the rail when the run may publish', () => {
    const refused = (command: string) => decideFor('auto', ASKED, command);
    expect(refused('git push origin main')).toEqual({
      verdict: 'reject',
      reason: otherBranchReason(BRANCH),
    });
    expect(refused(`git push --force origin ${BRANCH}`)).toEqual({
      verdict: 'reject',
      reason: PLAIN_FORCE_REASON,
    });
    expect(refused('git remote add fork https://example.net/fork.git')).toEqual({
      verdict: 'reject',
      reason: REMOTE_RAIL_REASON,
    });
    expect(refused('gh pr create --head some-other-branch --fill')).toEqual({
      verdict: 'reject',
      reason: ghRailReason('gh pr create'),
    });
  });

  it("refuses every push when the run is not on the chat's own branch", () => {
    for (const posture of POSTURES) {
      expect(decideFor(posture, ASKED, 'git push origin main', null)).toEqual({
        verdict: 'reject',
        reason: NO_TASK_BRANCH_REASON,
      });
    }
  });

  it.each([`git push -u origin ${BRANCH}`, 'gh pr create --fill', 'gh pr edit 12 --title x'])(
    "publishes the chat's own branch only when an agent may publish: %s",
    (command) => {
      for (const posture of POSTURES) {
        for (const grant of GRANTS) {
          const decision = decideFor(posture, grant, command);
          const expected = permitted(posture, grant)
            ? { verdict: 'allow' }
            : { verdict: 'reject', reason: CHAT_PUBLISH_REASON };
          expect(decision, `${posture} ${JSON.stringify(grant)}`).toMatchObject(expected);
        }
      }
    },
  );

  it('says why an own-branch push ran', () => {
    const push = `git push origin ${BRANCH}`;
    expect(decideFor('asks', ASKED, push)).toEqual({
      verdict: 'allow',
      by: 'level',
      why: PUBLISH_ASKED_WHY,
    });
    expect(decideFor('asks', FULL_AUTO, push)).toEqual({
      verdict: 'allow',
      by: 'level',
      why: PUBLISH_FULL_AUTO_WHY,
    });
    expect(decideFor('full_access', NOT_ASKED, push)).toEqual({
      verdict: 'allow',
      by: 'level',
    });
  });

  it('asks with hold-to-confirm before a lease force push of the own branch', () => {
    const command = `git push --force-with-lease origin ${BRANCH}`;
    for (const decision of everyDecision(command)) {
      expect(decision).toEqual({
        verdict: 'ask',
        reason: forcePushReason([BRANCH]),
        forcePush: [BRANCH],
      });
    }
  });

  it.each([
    'gh pr view 12',
    'gh pr view 5 --repo other/repo',
    'gh pr checks',
    'gh run view 1 --log-failed',
    'gh api repos/acme/app/pulls/12/comments',
    'git fetch origin',
    'git fetch origin main',
    'git remote -v',
    'git status',
    'git log --oneline -5',
  ])('never refuses a read: %s', (command) => {
    for (const posture of POSTURES) {
      for (const grant of GRANTS) {
        const options: DecideOptions = {
          changesProject: true,
          files,
          publish: { grant, task: TASK },
        };
        const decision = decide(posture, run(command), NO_RUN_RULES, [], options);
        expect(decision.verdict, `${posture} ${command}`).not.toBe('reject');
      }
    }
    const options: DecideOptions = {
      changesProject: true,
      files,
      publish: { grant: NOT_ASKED, task: TASK },
    };
    for (const posture of ['auto', 'full_access'] as const) {
      expect(decide(posture, run(command), NO_RUN_RULES, [], options).verdict).toBe('allow');
    }
  });
});

describe('writes through gh other than opening or editing a pull request', () => {
  const WRITES = [
    'gh pr merge 12',
    'gh pr comment 12 --body done',
    'gh issue create --title x --body y',
    `gh api graphql -f query='mutation { addComment(input: {subjectId: "x", body: "y"}) { clientMutationId } }'`,
    'glab mr create',
  ];

  it.each(WRITES)('stay refused in every mode: %s', (command) => {
    for (const decision of everyDecision(command)) {
      expect(decision.verdict, command).toBe('reject');
    }
  });
});

describe('a run with no publish context', () => {
  it('keeps the mode answer for a push, as a question turn is refused by its own rule', () => {
    expect(decide('asks', run('git push origin main'), NO_RUN_RULES, [], { files })).toMatchObject({
      verdict: 'ask',
    });
  });
});

describe('otherBranchPushes()', () => {
  it.each([
    ['git push origin main', ['main']],
    [`git push origin ${BRANCH} main`, ['main']],
    [`git push origin HEAD:spark/another-chat`, ['spark/another-chat']],
    ['cd app && git push origin release 2>&1 | tail -2', ['release']],
    ['sh -c "git push -u origin main"', ['main']],
    ['git push origin main && git push origin main', ['main']],
  ])('names the other branches of %s', (command, branches) => {
    expect(otherBranchPushes(command, TASK)).toEqual(branches);
  });

  it.each([
    `git push origin ${BRANCH}`,
    `git push -u origin HEAD:${BRANCH}`,
    'git push',
    'git push origin HEAD',
    'git fetch origin main',
    'git status',
    'gh pr view 12',
  ])("finds nothing in %s on the chat's own branch", (command) => {
    expect(otherBranchPushes(command, TASK)).toBeNull();
  });

  it('counts every push when the chat has no branch of its own or its branch is protected', () => {
    expect(otherBranchPushes('git push', null)).toEqual([]);
    expect(otherBranchPushes('git push origin feature', null)).toEqual(['feature']);
    expect(otherBranchPushes('git status', null)).toBeNull();
    const onMain = { branch: 'main', protectedBranches: ['main'] };
    expect(otherBranchPushes('git push origin main', onMain)).toEqual(['main']);
  });
});
