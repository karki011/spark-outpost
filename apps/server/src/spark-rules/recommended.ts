import {
  DEFAULT_SPARK_RULES,
  WORKFLOW_PREFIXES,
  type GhRuleChoice,
} from '@spark-outpost/contracts';
import { NO_SPARK_RULES, type SparkRuleSet } from './resolve.ts';
import { GH_ANY, ghRuleId, recognisedRule, type FloorRuleId } from './rule-ids.ts';
import { parseRulesFile } from './rules-file.ts';

export interface GhSeed {
  workflows: GhRuleChoice;
  ghAllowed: readonly string[];
}

export const RECOMMENDED_ASK: readonly FloorRuleId[] = [
  'Push(force)',
  'SecretFile(edit)',
  'SecretFile(read)',
  'InstructionFile(edit)',
  'GitConfig',
  'WriteOutside',
  'SecretSend',
];

export const RECOMMENDED_DENY: readonly FloorRuleId[] = [
  'Push',
  'Push(other)',
  'PullRequest',
  'GitRemote',
];

export const WORKFLOW_RULES: readonly string[] = WORKFLOW_PREFIXES.map(ghRuleId);

export function recommendedRulesText(gh: GhSeed = DEFAULT_SPARK_RULES): string {
  const follows = gh.workflows === 'mode';
  const allowed = gh.ghAllowed.map(ghRuleId).filter(recognisedRule);
  const permissions = {
    allow: [...(follows ? WORKFLOW_RULES : []), ...allowed],
    ask: [...RECOMMENDED_ASK],
    deny: [...RECOMMENDED_DENY, ...(follows ? [] : WORKFLOW_RULES), GH_ANY],
  };
  return `${JSON.stringify({ permissions }, null, 2)}\n`;
}

export function userRules(text: string): SparkRuleSet {
  return { ...NO_SPARK_RULES, user: parseRulesFile(text).lists };
}

export const RECOMMENDED_RULES: SparkRuleSet = userRules(recommendedRulesText());

export const WORKFLOWS_REFUSED_RULES: SparkRuleSet = userRules(
  recommendedRulesText({ workflows: 'refused', ghAllowed: [] }),
);
