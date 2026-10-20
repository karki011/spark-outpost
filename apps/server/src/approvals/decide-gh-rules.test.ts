import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import { CHAT_PUBLISH_REASON, NO_RUN_RULES, decide, type ApprovalRequest } from './decide.ts';
import type { FileLister } from './file-lister.ts';
import { NO_GH_RULES, sparkRuleReason, type GhRules } from './gh-rules.ts';
import { ghRailReason, type PublishGrant, type TaskBranch } from './publish-policy.ts';

const ROOT = '/work/app/.spark/worktrees/chat-1';
const BRANCH = 'spark/fix-dates-1a2b';
const TASK: TaskBranch = { branch: BRANCH, protectedBranches: ['main', 'master'], pull: 12 };
const files: FileLister = { glob: () => [], walk: () => [], script: () => null };
const MANUAL: PublishGrant = { level: 'hands-off', requested: false };
const FULL_AUTO: PublishGrant = { level: 'full-auto', requested: false };
const AT_ONCE: readonly ModePosture[] = ['auto', 'full_access'];
const CARDED: readonly ModePosture[] = ['asks', 'edits', 'unknown'];
const WORKFLOWS_FOLLOW: GhRules = { ...NO_GH_RULES, workflows: 'mode' };
const WORKFLOW = { group: 'workflows' as const, prefix: 'gh workflow run' };

function run(command: string, agentReason: string | null = null): ApprovalRequest {
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
    agentReason,
  };
}

function chat(posture: ModePosture, command: string, ghRules: GhRules, grant = MANUAL) {
  return decide(posture, run(command, 'Spark sends gh to the gate'), NO_RUN_RULES, [], {
    changesProject: true,
    files,
    ghRules,
    publish: { grant, task: TASK },
  });
}

describe('Run a workflow', () => {
  const commands = ['gh workflow run cd-alfa.yml', 'gh run rerun 4411', 'gh run cancel 4411'];

  it.each(commands)('follows the mode when set to follow it: %s', (command) => {
    for (const posture of AT_ONCE) {
      expect(chat(posture, command, WORKFLOWS_FOLLOW), posture).toEqual({
        verdict: 'allow',
        by: 'level',
      });
    }
    for (const posture of CARDED) {
      expect(chat(posture, command, WORKFLOWS_FOLLOW).verdict, posture).toBe('ask');
    }
    expect(chat('denies', command, WORKFLOWS_FOLLOW).verdict).toBe('reject');
  });

  it.each(commands)('is refused by the rule in every mode when Refused: %s', (command) => {
    const prefix = command.split(' ').slice(0, 3).join(' ');
    const rule = { group: 'workflows' as const, prefix };
    for (const posture of [...AT_ONCE, ...CARDED]) {
      for (const grant of [MANUAL, FULL_AUTO]) {
        expect(chat(posture, command, NO_GH_RULES, grant)).toEqual({
          verdict: 'reject',
          reason: sparkRuleReason(rule),
          sparkRule: rule,
        });
      }
    }
  });

  it('asks in Manual when it rides along a push the level allows', () => {
    const command = `git push origin ${BRANCH} && gh workflow run cd.yml`;
    expect(chat('asks', command, WORKFLOWS_FOLLOW, FULL_AUTO).verdict).toBe('ask');
    expect(chat('full_access', command, WORKFLOWS_FOLLOW, FULL_AUTO).verdict).toBe('allow');
  });

  it('names the rule when a refused workflow rides along a push', () => {
    const command = `git push origin ${BRANCH} && gh workflow run cd.yml`;
    for (const posture of [...AT_ONCE, ...CARDED]) {
      expect(chat(posture, command, NO_GH_RULES, FULL_AUTO)).toMatchObject({
        verdict: 'reject',
        sparkRule: WORKFLOW,
      });
    }
  });

  it('still refuses a merge chained after an allowed workflow', () => {
    const command = 'gh workflow run cd.yml && gh pr merge 12';
    expect(chat('full_access', command, WORKFLOWS_FOLLOW)).toEqual({
      verdict: 'reject',
      reason: ghRailReason('gh pr merge'),
    });
  });

  it('never runs while the agent plans, even in an Auto or Bypass chat', () => {
    for (const askRun of [false, true]) {
      const decision = decide(
        'read_only',
        run('gh workflow run cd.yml', 'Plan mode'),
        NO_RUN_RULES,
        [],
        {
          changesProject: true,
          askRun,
          planningWhy: 'Auto mode',
          files,
          ghRules: WORKFLOWS_FOLLOW,
        },
      );
      expect(decision.verdict, String(askRun)).not.toBe('allow');
    }
  });

  it('applies only to the chat agent, not to a run that changes nothing', () => {
    const decision = decide('full_access', run('gh workflow run cd.yml'), NO_RUN_RULES, [], {
      files,
      ghRules: NO_GH_RULES,
    });
    expect(decision).toEqual({ verdict: 'allow', by: 'level' });
  });
});

describe('Other commands', () => {
  const release = 'gh release create v1.2.0 --notes x';
  const allowed: GhRules = { ...NO_GH_RULES, allowed: ['gh release create'] };

  it('is refused by default with a card the user can change', () => {
    const rule = { group: 'other' as const, prefix: 'gh release create' };
    for (const posture of [...AT_ONCE, ...CARDED]) {
      expect(chat(posture, release, NO_GH_RULES)).toEqual({
        verdict: 'reject',
        reason: sparkRuleReason(rule),
        sparkRule: rule,
      });
    }
  });

  it('follows the mode once the user adds its prefix', () => {
    for (const posture of AT_ONCE) {
      expect(chat(posture, release, allowed)).toEqual({ verdict: 'allow', by: 'level' });
    }
    for (const posture of CARDED) expect(chat(posture, release, allowed).verdict).toBe('ask');
  });

  it.each([
    ['gh pr merge 12 --squash', 'gh pr merge'],
    ['gh pr review 12 --approve', 'gh pr review'],
    ['gh pr review 12 -a', 'gh pr review'],
    ['gh release create v1 --admin', 'gh release create'],
  ])('never allows %s, even when added', (command, named) => {
    const added: GhRules = {
      ...NO_GH_RULES,
      allowed: ['gh pr merge', 'gh pr review', 'gh release create'],
    };
    expect(chat('full_access', command, added)).toEqual({
      verdict: 'reject',
      reason: ghRailReason(named),
    });
    expect(chat('asks', command, added)).toEqual({
      verdict: 'reject',
      reason: CHAT_PUBLISH_REASON,
    });
  });

  it('lets a review comment through once gh pr review is added', () => {
    const added: GhRules = { ...NO_GH_RULES, allowed: ['gh pr review'] };
    expect(chat('full_access', 'gh pr review 12 --comment -b "Looks fine"', added).verdict).toBe(
      'allow',
    );
  });
});

describe('Allow once', () => {
  const command = 'gh workflow run cd-alfa.yml';
  const once: GhRules = { ...NO_GH_RULES, once: [command] };

  it('lets just that exact command follow the mode', () => {
    expect(chat('full_access', command, once)).toEqual({ verdict: 'allow', by: 'level' });
    expect(chat('asks', command, once).verdict).toBe('ask');
    expect(chat('full_access', `${command}  `, once).verdict).toBe('allow');
  });

  it('does not cover another command of the same group', () => {
    expect(chat('full_access', 'gh workflow run other.yml', once)).toMatchObject({
      verdict: 'reject',
      sparkRule: WORKFLOW,
    });
  });

  it('never covers a merge', () => {
    const merge = 'gh pr merge 12';
    const merging: GhRules = { ...NO_GH_RULES, once: [merge] };
    expect(chat('full_access', merge, merging).verdict).toBe('reject');
  });
});
