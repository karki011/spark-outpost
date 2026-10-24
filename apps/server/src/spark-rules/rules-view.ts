import {
  sparkRuleRowSchema,
  type GhAllowedEntry,
  type SparkRuleChoice,
  type SparkRuleRow,
  type SparkRuleRowState,
  type SparkRules,
} from '@spark-outpost/contracts';
import { RECOMMENDED_RULES, WORKFLOW_RULES } from './recommended.ts';
import { ghCommandRuling, NO_SPARK_RULES, type SparkRuleSet } from './resolve.ts';
import { ghPrefixOfRule, ghRuleId, isFloorRuleId } from './rule-ids.ts';
import { namesOneEntry, RULE_EFFECTS, type RuleChange, type RuleLists } from './rules-file.ts';
import type { LoadedRules } from './rules-store.ts';
import { unusedEntries } from './unused-entries.ts';

type Pair = readonly [(typeof RULE_EFFECTS)[number], string];

export function rowRuleIds(row: SparkRuleRow): readonly string[] {
  if (row === 'workflows') return WORKFLOW_RULES;
  return [row];
}

function named(lists: RuleLists, id: string): boolean {
  return RULE_EFFECTS.some((effect) => lists[effect].includes(id));
}

function effectiveChoice(rules: SparkRuleSet, id: string): SparkRuleChoice {
  for (const effect of ['deny', 'ask', 'allow'] as const) {
    if (rules.managed[effect].includes(id) || rules.user[effect].includes(id)) return effect;
  }
  return 'mode';
}

function rowState(rules: SparkRuleSet, row: SparkRuleRow): SparkRuleRowState {
  const ids = [...rowRuleIds(row)];
  const choices = new Set(ids.map((id) => effectiveChoice(rules, id)));
  const [only] = choices;
  const locked = ids.some((id) => named(rules.managed, id));
  const mine = ids.some((id) => named(rules.user, id));
  return {
    row,
    ids,
    choice: choices.size === 1 && only ? only : null,
    source: locked ? 'managed' : mine ? 'user' : null,
  };
}

export function rowLocked(rules: SparkRuleSet, row: SparkRuleRow): boolean {
  return rowRuleIds(row).some((id) => named(rules.managed, id));
}

function namedGhRule(rule: string): string | null {
  return WORKFLOW_RULES.includes(rule) || isFloorRuleId(rule) ? null : ghPrefixOfRule(rule);
}

export function allowedGhPrefixes(rules: SparkRuleSet): string[] {
  return rules.user.allow.flatMap((rule) => {
    const prefix = namedGhRule(rule);
    return prefix ? [prefix] : [];
  });
}

function allowedEntries(rules: SparkRuleSet): GhAllowedEntry[] {
  const companyOnly = { ...NO_SPARK_RULES, managed: rules.managed };
  return allowedGhPrefixes(rules).map((prefix) => ({
    prefix,
    overridden: ghCommandRuling(companyOnly, prefix)?.effect === 'deny',
  }));
}

export function sparkRulesView(loaded: LoadedRules): SparkRules {
  const { rules, userFile } = loaded;
  return {
    rows: sparkRuleRowSchema.options.map((row) => rowState(rules, row)),
    ghAllowed: allowedEntries(rules),
    unused: userFile.kind === 'text' ? unusedEntries(userFile.text) : [],
    problems: loaded.problems.filter(
      (problem) =>
        problem.file === 'managed' || loaded.userFailedSafe || !namesOneEntry(problem.message),
    ),
    malformed: loaded.userFailedSafe,
  };
}

export function choiceChange(row: SparkRuleRow, choice: SparkRuleChoice): RuleChange {
  const ids = rowRuleIds(row);
  const remove: Pair[] = RULE_EFFECTS.flatMap((effect) => ids.map((id) => [effect, id] as const));
  const add: Pair[] = choice === 'mode' ? [] : ids.map((id) => [choice, id] as const);
  return { add, remove };
}

export function ghAllowedChange(prefix: string, allowed: boolean): RuleChange {
  const id = ghRuleId(prefix);
  if (!allowed) return { remove: [['allow', id]] };
  return {
    add: [['allow', id]],
    remove: [
      ['ask', id],
      ['deny', id],
    ],
  };
}

export function recommendedChange(): RuleChange {
  const lists = RECOMMENDED_RULES.user;
  const add: Pair[] = RULE_EFFECTS.flatMap((effect) =>
    lists[effect].map((id) => [effect, id] as const),
  );
  const remove: Pair[] = add.flatMap(([, id]) =>
    RULE_EFFECTS.map((effect) => [effect, id] as const),
  );
  return { add, remove };
}
