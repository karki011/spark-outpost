import { describe, expect, it } from 'vitest';
import { MODE_POSTURES, type ModePosture } from '@spark-outpost/contracts';
import {
  CHAT_PUBLISH_REASON,
  NO_RUN_RULES,
  PUBLISH_ASKED_WHY,
  PUBLISH_FOLLOW_UP_WHY,
  PUBLISH_FULL_AUTO_WHY,
  PUSH_REASON,
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
  otherBranchReason,
  type PublishGrant,
  type TaskBranch,
} from './publish-policy.ts';

const ROOT = '/work/app/.spark/worktrees/chat-1';
const BRANCH = 'spark/fix-dates-1a2b';
const TASK: TaskBranch = { branch: BRANCH, protectedBranches: ['main', 'master'], pull: 12 };
const files: FileLister = { glob: () => [], walk: () => [], script: () => null };
const FOLLOW_UP = { workspaceId: 'w1', conversationId: 'c1' };
const NOT_ASKED: PublishGrant = { level: 'hands-off', requested: false };
const ASKED: PublishGrant = { level: 'hands-off', requested: true };
const FULL_AUTO: PublishGrant = { level: 'full-auto', requested: false };
const ROUND: PublishGrant = { level: 'hands-off', requested: false, followUp: FOLLOW_UP };
const GRANTS = [NOT_ASKED, ASKED, FULL_AUTO, ROUND];
const PERFORMING: readonly ModePosture[] = ['auto', 'full_access'];
const NO_MODE_BASIS = MODE_POSTURES.filter((posture) => !PERFORMING.includes(posture));

const PUSH = `git push -u origin ${BRANCH}`;
const PR = 'gh pr create --title "Fix dates" --body "Parses ISO dates"';

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
  task: TaskBranch | null = TASK,
): Decision {
  const options: DecideOptions = { chatRun: true, files, publish: { grant, task } };
  return decide(posture, run(command), NO_RUN_RULES, [command, 'git', 'gh'], options);
}

function everywhere(command: string): Decision[] {
  return MODE_POSTURES.flatMap((posture) =>
    GRANTS.map((grant) => chatRun(posture, grant, command)),
  );
}

const refused = (reason: string): Decision => ({ verdict: 'reject', reason });

describe("decide() for the chat's own changing run", () => {
  it.each([
    'git push origin main',
    'git push origin some-other-branch',
    'git push origin spark/another-chat',
    `git push origin ${BRANCH} main`,
    'git push',
    'git push --all origin',
    `git push https://github.com/acme/app.git ${BRANCH}`,
    'gh pr create --head some-other-branch --fill',
    'gh pr edit 77 --title x',
    'sh -c "git push origin main"',
  ])('refuses anything but its own branch in every mode and at every level: %s', (command) => {
    for (const decision of everywhere(command)) expect(decision.verdict, command).toBe('reject');
  });

  it('names the branch that may be pushed when the run may publish', () => {
    expect(chatRun('auto', ASKED, 'git push origin main')).toEqual(
      refused(otherBranchReason(BRANCH)),
    );
    expect(chatRun('asks', FULL_AUTO, PUSH, null)).toEqual(refused(NO_TASK_BRANCH_REASON));
  });

  it.each([PUSH, PR])('refuses %s when nothing gives the run a reason to publish', (command) => {
    for (const posture of NO_MODE_BASIS) {
      expect(chatRun(posture, NOT_ASKED, command), posture).toEqual(refused(CHAT_PUBLISH_REASON));
    }
  });

  it.each([PUSH, PR])('allows %s on its own branch when the run may publish', (command) => {
    const allowed = (why: string) => ({ verdict: 'allow', by: 'level', why });
    expect(chatRun('asks', ASKED, command)).toEqual(allowed(PUBLISH_ASKED_WHY));
    expect(chatRun('asks', FULL_AUTO, command)).toEqual(allowed(PUBLISH_FULL_AUTO_WHY));
    expect(chatRun('edits', ROUND, command)).toEqual(allowed(PUBLISH_FOLLOW_UP_WHY));
    for (const posture of PERFORMING) {
      expect(chatRun(posture, NOT_ASKED, command)).toEqual({ verdict: 'allow', by: 'level' });
    }
  });

  it('refuses a force push in every mode and at every level', () => {
    for (const command of [`git push --force origin ${BRANCH}`, `git push origin +${BRANCH}`]) {
      for (const decision of everywhere(command)) expect(decision.verdict).toBe('reject');
    }
    expect(chatRun('full_access', ASKED, `git push --force origin ${BRANCH}`)).toEqual(
      refused(PLAIN_FORCE_REASON),
    );
  });

  it('asks with hold-to-confirm for a lease push of its own branch and refuses one of another branch', () => {
    const lease = (branch: string) => `git push --force-with-lease origin ${branch}`;
    for (const grant of GRANTS) {
      expect(chatRun('asks', grant, lease(BRANCH))).toEqual({
        verdict: 'ask',
        reason: forcePushReason([BRANCH]),
        forcePush: [BRANCH],
      });
      expect(chatRun('asks', grant, lease('feature/other'))).toEqual(
        refused(otherBranchReason(BRANCH)),
      );
    }
  });

  it.each([
    'git remote add fork https://example.net/fork.git',
    'git remote set-url origin https://example.net/other.git',
    'git send-email HEAD~1',
    'glab mr create --fill',
  ])('refuses a remote change in every mode and at every level: %s', (command) => {
    for (const decision of everywhere(command)) expect(decision.verdict, command).toBe('reject');
    expect(chatRun('full_access', FULL_AUTO, command)).toEqual(refused(REMOTE_RAIL_REASON));
  });

  it.each([
    ['gh pr merge 12 --squash', 'gh pr merge'],
    ['gh pr review 12 --approve', 'gh pr review'],
    ['gh api -X POST repos/acme/app/pulls/12/merge', 'gh api'],
    ['gh repo delete acme/app --yes', 'gh repo delete'],
  ])('refuses the gh write %s by name', (command, named) => {
    for (const decision of everywhere(command)) expect(decision.verdict, command).toBe('reject');
    expect(chatRun('auto', ASKED, command)).toEqual(refused(ghRailReason(named)));
  });

  it.each([
    'gh pr view 12 --json state',
    'gh pr view 77',
    'gh pr checks 12',
    'gh pr diff 77',
    'gh pr list --state open',
    'gh run view 4411 --log-failed',
    'gh api repos/acme/app/pulls/77/comments',
    'gh auth status',
    'git fetch origin',
    'git fetch origin main',
    'git pull --ff-only origin main',
    'git remote -v',
  ])('never refuses a read through gh or git for the publish rules: %s', (command) => {
    for (const posture of MODE_POSTURES.filter((mode) => mode !== 'denies')) {
      for (const grant of GRANTS) {
        expect(chatRun(posture, grant, command).verdict, `${posture} ${command}`).not.toBe(
          'reject',
        );
      }
    }
  });
});

describe('decide() for a run that is neither the chat run nor a Builder', () => {
  it('is not given the chat run rules', () => {
    const options: DecideOptions = { files, publish: { grant: NOT_ASKED, task: TASK } };
    expect(decide('asks', run(PUSH), NO_RUN_RULES, [], options)).toEqual({
      verdict: 'ask',
      reason: PUSH_REASON,
    });
  });
});
