import { GH_ANY, ghRuleId, type FloorRuleId } from './rule-ids.ts';
import { NO_RULE_LISTS, type RuleEffect, type RuleLists } from './rules-file.ts';

export type RuleTier = 'managed' | 'user';

export interface SparkRuleSet {
  managed: RuleLists;
  user: RuleLists;
}

export interface RuleRuling {
  effect: RuleEffect;
  tier: RuleTier;
  id: string;
}

export const NO_SPARK_RULES: SparkRuleSet = { managed: NO_RULE_LISTS, user: NO_RULE_LISTS };

const STRENGTH: readonly RuleEffect[] = ['deny', 'ask', 'allow'];
const TIERS: readonly RuleTier[] = ['managed', 'user'];

function tierRuling(lists: RuleLists, tier: RuleTier, id: string): RuleRuling | null {
  const effect = STRENGTH.find((candidate) => lists[candidate].includes(id));
  return effect ? { effect, tier, id } : null;
}

function strongest(rulings: readonly (RuleRuling | null)[]): RuleRuling | null {
  const found = rulings.filter((entry): entry is RuleRuling => entry !== null);
  for (const effect of STRENGTH) {
    const match = found.find((entry) => entry.effect === effect);
    if (match) return match;
  }
  return null;
}

export function floorRuling(set: SparkRuleSet, id: FloorRuleId): RuleRuling | null {
  return strongest(TIERS.map((tier) => tierRuling(set[tier], tier, id)));
}

export function floorEffect(set: SparkRuleSet, id: FloorRuleId): RuleEffect | null {
  return floorRuling(set, id)?.effect ?? null;
}

export function ghExactRuling(set: SparkRuleSet, prefix: string): RuleRuling | null {
  const id = ghRuleId(prefix);
  return strongest(TIERS.map((tier) => tierRuling(set[tier], tier, id)));
}

export function ghCommandRuling(set: SparkRuleSet, prefix: string): RuleRuling | null {
  const id = ghRuleId(prefix);
  return strongest(
    TIERS.map((tier) => tierRuling(set[tier], tier, id) ?? tierRuling(set[tier], tier, GH_ANY)),
  );
}
