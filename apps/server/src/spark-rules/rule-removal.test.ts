import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import { decide, NO_RUN_RULES, type ApprovalRequest, type Decision } from '../approvals/decide.ts';
import type { FileLister } from '../approvals/file-lister.ts';
import type { SecretSend } from '../approvals/secret-send.ts';
import type { PublishGrant } from '../approvals/publish-policy.ts';
import { RECOMMENDED_RULES } from './recommended.ts';
import { NO_SPARK_RULES, type SparkRuleSet } from './resolve.ts';
import { GH_ANY, type FloorRuleId } from './rule-ids.ts';
import { NO_RULE_LISTS, type RuleEffect, type RuleLists } from './rules-file.ts';

const ROOT = '/work/app/.spark/worktrees/chat-1';
const BRANCH = 'spark/fix-dates-1a2b';
const files: FileLister = { glob: () => [], walk: () => [], script: () => null };
const UNASKED: PublishGrant = { level: 'hands-off', requested: false };
const ASKED: PublishGrant = { level: 'hands-off', requested: true };
const MANUAL: ModePosture = 'asks';
const AUTO: ModePosture = 'auto';

function request(command: string | null, edited?: string): ApprovalRequest {
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: edited ? 'edit' : 'execute',
    toolKind: edited ? 'edit' : 'execute',
    title: command ?? `Edit ${edited}`,
    command,
    cwd: ROOT,
    paths: edited ? [`${ROOT}/${edited}`] : [],
    diffs: [],
    options: [],
    roots: [{ path: ROOT, ignore: ['private/**'] }],
    home: '/Users/me',
  };
}

interface Example {
  rule: FloorRuleId | typeof GH_ANY;
  unaskedOnly?: boolean;
  asked: ApprovalRequest;
  grant: PublishGrant;
  secretSend?: SecretSend;
  seeded: Record<'manual' | 'auto', Decision['verdict']>;
  removed: Record<'manual' | 'auto', Decision['verdict']>;
}

const SECRET_FOUND: SecretSend = { kind: 'found', files: ['.env'] };

const EXAMPLES: Example[] = [
  {
    rule: 'Push',
    unaskedOnly: true,
    asked: request(`git push origin ${BRANCH}`),
    grant: UNASKED,
    seeded: { manual: 'reject', auto: 'allow' },
    removed: { manual: 'ask', auto: 'allow' },
  },
  {
    rule: 'Push(other)',
    asked: request('git push origin main'),
    grant: ASKED,
    seeded: { manual: 'reject', auto: 'reject' },
    removed: { manual: 'ask', auto: 'allow' },
  },
  {
    rule: 'Push(force)',
    asked: request(`git push --force-with-lease origin ${BRANCH}`),
    grant: ASKED,
    seeded: { manual: 'ask', auto: 'ask' },
    removed: { manual: 'allow', auto: 'allow' },
  },
  {
    rule: 'PullRequest',
    unaskedOnly: true,
    asked: request('gh pr create --fill'),
    grant: UNASKED,
    seeded: { manual: 'reject', auto: 'allow' },
    removed: { manual: 'ask', auto: 'allow' },
  },
  {
    rule: 'GitRemote',
    asked: request('git remote add fork https://example.net/fork.git'),
    grant: ASKED,
    seeded: { manual: 'reject', auto: 'reject' },
    removed: { manual: 'ask', auto: 'allow' },
  },
  {
    rule: GH_ANY,
    asked: request('gh release create v1.2.0 --notes x'),
    grant: UNASKED,
    seeded: { manual: 'reject', auto: 'reject' },
    removed: { manual: 'ask', auto: 'allow' },
  },
  {
    rule: 'SecretFile(edit)',
    asked: request(null, '.env'),
    grant: UNASKED,
    seeded: { manual: 'ask', auto: 'ask' },
    removed: { manual: 'ask', auto: 'allow' },
  },
  {
    rule: 'SecretFile(read)',
    asked: request('cat private/notes.md'),
    grant: UNASKED,
    seeded: { manual: 'ask', auto: 'ask' },
    removed: { manual: 'allow', auto: 'allow' },
  },
  {
    rule: 'InstructionFile(edit)',
    asked: request(null, 'AGENTS.md'),
    grant: UNASKED,
    seeded: { manual: 'ask', auto: 'ask' },
    removed: { manual: 'ask', auto: 'allow' },
  },
  {
    rule: 'GitConfig',
    asked: request('git config core.hooksPath hooks'),
    grant: UNASKED,
    seeded: { manual: 'ask', auto: 'ask' },
    removed: { manual: 'ask', auto: 'allow' },
  },
  {
    rule: 'WriteOutside',
    asked: request('echo hi > ../outside.txt'),
    grant: UNASKED,
    seeded: { manual: 'ask', auto: 'ask' },
    removed: { manual: 'ask', auto: 'ask' },
  },
  {
    rule: 'SecretSend',
    asked: request(`git push origin ${BRANCH}`),
    grant: ASKED,
    secretSend: SECRET_FOUND,
    seeded: { manual: 'ask', auto: 'ask' },
    removed: { manual: 'allow', auto: 'allow' },
  },
];

function without(lists: RuleLists, rule: string): RuleLists {
  const drop = (list: readonly string[]) => list.filter((entry) => entry !== rule);
  return { allow: drop(lists.allow), ask: drop(lists.ask), deny: drop(lists.deny) };
}

function moved(lists: RuleLists, rule: string, to: RuleEffect): RuleLists {
  const left = without(lists, rule);
  return { ...left, [to]: [...left[to], rule] };
}

function judged(example: Example, posture: ModePosture, rules: SparkRuleSet): Decision {
  return decide(posture, example.asked, NO_RUN_RULES, [], {
    changesProject: true,
    files,
    browserData: null,
    sparkRules: { rules, once: [] },
    publish: { grant: example.grant, task: { branch: BRANCH, protectedBranches: ['main'] } },
    ...(example.secretSend ? { secretSend: example.secretSend } : {}),
  });
}

const removedFrom = (rule: string): SparkRuleSet => ({
  ...RECOMMENDED_RULES,
  user: without(RECOMMENDED_RULES.user, rule),
});

describe('each Spark rule', () => {
  it.each(EXAMPLES)('$rule: the recommended rules give today’s verdict', (example) => {
    expect(judged(example, MANUAL, RECOMMENDED_RULES).verdict).toBe(example.seeded.manual);
    expect(judged(example, AUTO, RECOMMENDED_RULES).verdict).toBe(example.seeded.auto);
  });

  it.each(EXAMPLES)('$rule: removing it hands the call to the agent’s mode', (example) => {
    const rules = removedFrom(example.rule);
    expect(judged(example, MANUAL, rules).verdict).toBe(example.removed.manual);
    expect(judged(example, AUTO, rules).verdict).toBe(example.removed.auto);
    for (const posture of [MANUAL, AUTO]) {
      expect(judged(example, posture, rules)).toEqual(judged(example, posture, NO_SPARK_RULES));
    }
  });

  const covered = (example: Example): ModePosture[] =>
    example.unaskedOnly ? [MANUAL, 'edits'] : [MANUAL, AUTO, 'full_access'];

  it.each(EXAMPLES)('$rule: deny refuses it in every mode it covers', (example) => {
    const rules = {
      ...RECOMMENDED_RULES,
      user: moved(RECOMMENDED_RULES.user, example.rule, 'deny'),
    };
    for (const posture of covered(example)) {
      expect(judged(example, posture, rules).verdict, posture).toBe('reject');
    }
  });

  it('leaves Push and PullRequest out when the mode or the message already allows publishing', () => {
    const push = EXAMPLES.find((example) => example.rule === 'Push')!;
    const rules = { ...RECOMMENDED_RULES, user: moved(RECOMMENDED_RULES.user, 'Push', 'ask') };
    expect(judged(push, AUTO, rules).verdict).toBe('allow');
    expect(judged({ ...push, grant: ASKED }, MANUAL, rules).verdict).toBe('allow');
  });

  it.each(EXAMPLES)('$rule: ask shows a card in every mode it covers', (example) => {
    const rules = {
      ...RECOMMENDED_RULES,
      user: moved(RECOMMENDED_RULES.user, example.rule, 'ask'),
    };
    for (const posture of covered(example)) {
      expect(judged(example, posture, rules).verdict, posture).toBe('ask');
    }
  });
});

describe('two files', () => {
  const release = EXAMPLES.find((example) => example.rule === GH_ANY)!;
  const onlyUser = (user: RuleLists): SparkRuleSet => ({ managed: NO_RULE_LISTS, user });

  it('lets a named gh command in the same file escape Gh(*)', () => {
    const user = moved(RECOMMENDED_RULES.user, 'Gh(release create)', 'allow');
    expect(judged(release, AUTO, onlyUser(user)).verdict).toBe('allow');
    expect(judged(release, MANUAL, onlyUser(user)).verdict).toBe('ask');
  });

  it('never lets the user file loosen the company file', () => {
    const managed: RuleLists = { ...NO_RULE_LISTS, deny: [GH_ANY, 'Push(other)'] };
    const user: RuleLists = { ...NO_RULE_LISTS, allow: ['Gh(release create)', 'Push(other)'] };
    const rules = { managed, user };
    const refused = judged(release, AUTO, rules);
    expect(refused).toMatchObject({ verdict: 'reject' });
    expect(refused).not.toHaveProperty('sparkRule');
    if (refused.verdict === 'reject') expect(refused.reason).toContain('managed-settings.json');
    const other = EXAMPLES.find((example) => example.rule === 'Push(other)')!;
    expect(judged(other, AUTO, rules).verdict).toBe('reject');
  });

  it('lets deny win over allow and ask in any file', () => {
    const managed: RuleLists = { ...NO_RULE_LISTS, allow: ['WriteOutside'] };
    const user: RuleLists = { ...NO_RULE_LISTS, ask: ['WriteOutside'], deny: ['WriteOutside'] };
    const outside = EXAMPLES.find((example) => example.rule === 'WriteOutside')!;
    expect(judged(outside, AUTO, { managed, user }).verdict).toBe('reject');
  });

  it('lets the user file tighten what the company file allows', () => {
    const managed: RuleLists = { ...NO_RULE_LISTS, allow: ['Gh(release create)'] };
    const user: RuleLists = { ...NO_RULE_LISTS, ask: ['Gh(release create)'] };
    expect(judged(release, AUTO, { managed, user }).verdict).toBe('ask');
  });
});
