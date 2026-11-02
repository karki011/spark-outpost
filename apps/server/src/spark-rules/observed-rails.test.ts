import { describe, expect, it } from 'vitest';
import type { ApprovalRequest } from '../approvals/decide.ts';
import { railCrossings } from '../approvals/rail-crossings.ts';
import { parseShell } from '../approvals/shell-parse.ts';
import { RECOMMENDED_RULES } from './recommended.ts';
import type { SparkRuleSet } from './resolve.ts';
import type { FloorRuleId } from './rule-ids.ts';
import { NO_RULE_LISTS, type RuleEffect } from './rules-file.ts';

const ROOT = '/work/app';

function request(overrides: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title: 'observed',
    command: null,
    cwd: ROOT,
    paths: [],
    diffs: [],
    options: [],
    roots: [{ path: ROOT, ignore: [] }],
    home: '/Users/me',
    ...overrides,
  };
}

async function command(text: string): Promise<[ApprovalRequest, ReturnType<typeof parseShell>]> {
  return [request({ command: text, title: text }), parseShell(text)];
}

const edit = (target: string) =>
  request({ kind: 'edit', toolKind: 'edit', command: null, paths: [target] });

function removed(rule: FloorRuleId): SparkRuleSet {
  const user = RECOMMENDED_RULES.user;
  return {
    managed: RECOMMENDED_RULES.managed,
    user: {
      allow: user.allow.filter((entry) => entry !== rule),
      ask: user.ask.filter((entry) => entry !== rule),
      deny: user.deny.filter((entry) => entry !== rule),
    },
  };
}

function only(effect: RuleEffect, rule: FloorRuleId): SparkRuleSet {
  return { managed: NO_RULE_LISTS, user: { ...NO_RULE_LISTS, [effect]: [rule] } };
}

interface Case {
  rule: FloorRuleId;
  rail: string;
  observed: () => Promise<ApprovalRequest | [ApprovalRequest, ReturnType<typeof parseShell>]>;
}

const CASES: Case[] = [
  { rule: 'WriteOutside', rail: 'outside_write', observed: async () => edit('/Users/me/x.txt') },
  { rule: 'WriteOutside', rail: 'outside_delete', observed: () => command('rm -rf /Users/me/old') },
  { rule: 'SecretFile(edit)', rail: 'secret', observed: async () => edit(`${ROOT}/.env`) },
  {
    rule: 'InstructionFile(edit)',
    rail: 'instructions',
    observed: async () => edit(`${ROOT}/AGENTS.md`),
  },
  { rule: 'GitConfig', rail: 'git_control', observed: () => command('git config core.x /x') },
  {
    rule: 'Push(force)',
    rail: 'force_push',
    observed: () => command('git push --force origin spark/task'),
  },
];

async function railsFound(found: Case['observed'], rules: SparkRuleSet): Promise<string[]> {
  const observed = await found();
  const [asked, shell] = Array.isArray(observed) ? observed : [observed, null];
  const crossings = await railCrossings(asked, { shell: await shell, rules });
  return crossings.map((crossing) => crossing.rail);
}

describe('observed rail flags follow the resolved Spark rules', () => {
  it.each(CASES)('flags $rail under the recommended rules', async ({ rail, observed }) => {
    expect(await railsFound(observed, RECOMMENDED_RULES)).toEqual([rail]);
  });

  it.each(CASES)('does not flag $rail once $rule is removed', async ({ rule, observed }) => {
    expect(await railsFound(observed, removed(rule))).toEqual([]);
  });

  it.each(CASES)(
    'flags $rail when $rule is ask or deny alone',
    async ({ rule, rail, observed }) => {
      expect(await railsFound(observed, only('ask', rule))).toEqual([rail]);
      expect(await railsFound(observed, only('deny', rule))).toEqual([rail]);
    },
  );

  it('does not flag a rule the user moved to allow', async () => {
    const [first] = CASES;
    expect(await railsFound(first!.observed, only('allow', first!.rule))).toEqual([]);
  });

  it("keeps flagging Spark's browser data, which no rule lifts", async () => {
    const data = '/Users/me/Library/Application Support/Spark Outpost';
    const read = request({ kind: 'other', toolKind: 'read', paths: [`${data}/postgres-password`] });
    const crossings = await railCrossings(read, {
      browserData: data,
      rules: { managed: NO_RULE_LISTS, user: NO_RULE_LISTS },
    });
    expect(crossings).toEqual([{ rail: 'browser_data', paths: [] }]);
  });
});
