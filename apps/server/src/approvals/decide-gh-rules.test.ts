import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import { CHAT_PUBLISH_REASON, NO_RUN_RULES, decide, type ApprovalRequest } from './decide.ts';
import type { FileLister } from './file-lister.ts';
import { recommendedRulesText, userRules, type GhSeed } from '../spark-rules/recommended.ts';
import { DEFAULT_RULE_CONTEXT, sparkRuleReason, type SparkRuleContext } from './gh-rules.ts';
import { ghRailReason, type PublishGrant, type TaskBranch } from './publish-policy.ts';

const ROOT = '/work/app/.spark/worktrees/chat-1';
const BRANCH = 'spark/fix-dates-1a2b';
const TASK: TaskBranch = { branch: BRANCH, protectedBranches: ['main', 'master'], pull: 12 };
const files: FileLister = { glob: () => [], walk: () => [], script: () => null };
const MANUAL: PublishGrant = { level: 'hands-off', requested: false };
const FULL_AUTO: PublishGrant = { level: 'full-auto', requested: false };
const AT_ONCE: readonly ModePosture[] = ['auto', 'full_access'];
const CARDED: readonly ModePosture[] = ['asks', 'edits', 'unknown'];
function seeded(gh: Partial<GhSeed>): SparkRuleContext {
  const rules = userRules(recommendedRulesText({ workflows: 'refused', ghAllowed: [], ...gh }));
  return { rules, once: [] };
}

function without(context: SparkRuleContext, id: string): SparkRuleContext {
  const lists = context.rules.user;
  const user = {
    allow: lists.allow.filter((rule) => rule !== id),
    ask: lists.ask.filter((rule) => rule !== id),
    deny: lists.deny.filter((rule) => rule !== id),
  };
  return { ...context, rules: { ...context.rules, user } };
}

function asking(context: SparkRuleContext, id: string): SparkRuleContext {
  const user = { ...context.rules.user, ask: [...context.rules.user.ask, id] };
  return { ...context, rules: { ...context.rules, user } };
}

const WORKFLOWS_FOLLOW = seeded({ workflows: 'mode' });
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

function chat(posture: ModePosture, command: string, sparkRules: SparkRuleContext, grant = MANUAL) {
  return decide(posture, run(command, 'Spark sends gh to the gate'), NO_RUN_RULES, [], {
    changesProject: true,
    files,
    sparkRules,
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
        expect(chat(posture, command, DEFAULT_RULE_CONTEXT, grant)).toEqual({
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
      expect(chat(posture, command, DEFAULT_RULE_CONTEXT, FULL_AUTO)).toMatchObject({
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
          sparkRules: WORKFLOWS_FOLLOW,
        },
      );
      expect(decision.verdict, String(askRun)).not.toBe('allow');
    }
  });

  it('applies only to the chat agent, not to a run that changes nothing', () => {
    const decision = decide('full_access', run('gh workflow run cd.yml'), NO_RUN_RULES, [], {
      files,
      sparkRules: DEFAULT_RULE_CONTEXT,
    });
    expect(decision).toEqual({ verdict: 'allow', by: 'level' });
  });
});

describe('Other commands', () => {
  const release = 'gh release create v1.2.0 --notes x';
  const allowed = seeded({ ghAllowed: ['gh release create'] });

  it('is refused by default with a card the user can change', () => {
    const rule = { group: 'other' as const, prefix: 'gh release create' };
    for (const posture of [...AT_ONCE, ...CARDED]) {
      expect(chat(posture, release, DEFAULT_RULE_CONTEXT)).toEqual({
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
    ['gh pr merge 12 --squash', 'gh pr merge', 'Gh(pr merge)'],
    ['gh pr review 12 --approve', 'gh pr review', 'Gh(pr review)'],
    ['gh pr review 12 -a', 'gh pr review', 'Gh(pr review)'],
    ['gh release create v1 --admin', 'gh release create', 'GhAdmin'],
    ['gh auth logout', 'gh auth logout', 'Gh(auth)'],
    ['gh api -X DELETE repos/a/b', 'gh api', 'Gh(api write)'],
  ])('refuses %s by its own rule, and hands it to the mode without it', (command, named, id) => {
    const added = seeded({ ghAllowed: ['gh release create'] });
    expect(chat('full_access', command, added)).toEqual({
      verdict: 'reject',
      reason: ghRailReason(named),
    });
    expect(chat('asks', command, added)).toEqual({
      verdict: 'reject',
      reason: CHAT_PUBLISH_REASON,
    });
    const lifted = without(added, id);
    expect(chat('full_access', command, lifted).verdict).toBe('allow');
    expect(chat('asks', command, lifted).verdict).toBe('ask');
    expect(chat('full_access', command, asking(lifted, id)).verdict).toBe('ask');
  });

  it('lets a review comment through once gh pr review is added', () => {
    const added = seeded({ ghAllowed: ['gh pr review'] });
    expect(chat('full_access', 'gh pr review 12 --comment -b "Looks fine"', added).verdict).toBe(
      'allow',
    );
  });
});

describe('Allow once', () => {
  const command = 'gh workflow run cd-alfa.yml';
  const once: SparkRuleContext = { ...DEFAULT_RULE_CONTEXT, once: [command] };

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
    const merging: SparkRuleContext = { ...DEFAULT_RULE_CONTEXT, once: [merge] };
    expect(chat('full_access', merge, merging).verdict).toBe('reject');
  });
});
