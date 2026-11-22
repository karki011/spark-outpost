import { describe, expect, it } from 'vitest';
import { ASK_AUTO_WHY, NO_RUN_RULES, decide, type ApprovalRequest } from './decide.ts';
import { ASK_RUN_REASON } from './ask-run.ts';
import { baseOnlyReason, baseUpdateRefusal } from './base-update.ts';

const ROOT = '/work/app';

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

const unpushed = { base: 'main', rebase: true };
const pushed = { base: 'main', rebase: false };
const step = (baseUpdate: typeof unpushed | null, askAutoWhy: string | null = ASK_AUTO_WHY) => ({
  askRun: true,
  askEdits: true,
  baseUpdate,
  askAutoWhy,
});

describe('decide() for a workflow step that may update its branch from its base', () => {
  it.each([
    'git pull --no-rebase origin main',
    'git pull --ff-only origin main',
    'git merge origin/main',
    'git merge --no-edit main',
    'git merge --abort',
    'git merge --continue',
    'GIT_EDITOR=true git merge --continue',
    'git rebase --abort',
    'git add src/a.ts src/b.ts',
    'git add -u',
  ])('lets %s follow the step’s mode', (command) => {
    expect(decide('read_only', run(command), NO_RUN_RULES, [], step(pushed))).toEqual({
      verdict: 'allow',
      by: 'level',
      why: ASK_AUTO_WHY,
    });
    expect(decide('read_only', run(command), NO_RUN_RULES, [], step(pushed, null))).toMatchObject({
      verdict: 'ask',
    });
  });

  it.each(['git rebase origin/main', 'git pull --rebase origin main', 'git pull origin main'])(
    'lets %s run while the branch is not on the remote',
    (command) => {
      expect(decide('read_only', run(command), NO_RUN_RULES, [], step(unpushed))).toEqual({
        verdict: 'allow',
        by: 'level',
        why: ASK_AUTO_WHY,
      });
    },
  );

  it.each(['git rebase origin/main', 'git pull --rebase origin main', 'git pull origin main'])(
    'refuses %s once the branch is on the remote and says to merge',
    (command) => {
      expect(decide('read_only', run(command), NO_RUN_RULES, [], step(pushed))).toMatchObject({
        verdict: 'reject',
        reason: baseUpdateRefusal('main'),
      });
    },
  );

  it.each([
    'git merge feature/other',
    'git pull origin feature/other',
    'git pull upstream main',
    'git pull git@github.com:acme/app.git main',
    'git rebase -i origin/main',
    'git rebase --onto main other',
    'git pull --autostash origin main',
    'git merge -s ours origin/main',
    'git add -A',
    'git add .',
  ])('refuses %s with the base it may use', (command) => {
    expect(decide('read_only', run(command), NO_RUN_RULES, [], step(unpushed))).toMatchObject({
      verdict: 'reject',
      reason: baseOnlyReason('main'),
    });
  });

  it.each([
    'git commit -m "merge"',
    'git push origin spark/fix',
    'git reset --hard origin/main',
    'git checkout main',
    'git stash',
    'git merge origin/main && git push',
    'cd sub && git merge origin/main',
    'git -c core.hooksPath=/tmp merge origin/main',
    'HUSKY=0 git merge origin/main',
  ])('still refuses %s', (command) => {
    expect(decide('read_only', run(command), NO_RUN_RULES, [], step(unpushed))).toMatchObject({
      verdict: 'reject',
    });
  });

  it('keeps every base update refused for a step without the option', () => {
    for (const command of ['git pull --no-rebase origin main', 'git merge origin/main']) {
      expect(decide('read_only', run(command), NO_RUN_RULES, [], step(null))).toMatchObject({
        verdict: 'reject',
        reason: ASK_RUN_REASON,
      });
    }
  });
});
