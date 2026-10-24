import { SPARK_FLOOR_RULE_IDS, type SparkFloorRuleId } from '@spark-outpost/contracts';

export type FloorRuleId = SparkFloorRuleId;

export const GH_ANY = 'Gh(*)';

const GH_RULE = /^Gh\(([a-z][a-z0-9-]*) ([a-z][a-z0-9-]*)\)$/;
const FLOOR_IDS: ReadonlySet<string> = new Set(SPARK_FLOOR_RULE_IDS);

export function isFloorRuleId(text: string): text is FloorRuleId {
  return FLOOR_IDS.has(text);
}

export function recognisedRule(text: string): boolean {
  return isFloorRuleId(text) || text === GH_ANY || GH_RULE.test(text);
}

export function ghRuleId(prefix: string): string {
  return `Gh(${prefix.replace(/^gh /, '')})`;
}

export function ghPrefixOfRule(rule: string): string | null {
  const match = GH_RULE.exec(rule);
  return match ? `gh ${match[1]} ${match[2]}` : null;
}
