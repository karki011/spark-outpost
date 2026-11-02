import { floorEffect, type SparkRuleSet } from '../spark-rules/resolve.ts';
import type { FloorRuleId } from '../spark-rules/rule-ids.ts';
import type { RuleEffect } from '../spark-rules/rules-file.ts';
import type { Decision } from './decide.ts';
import type { ForcePush } from './git-commands.ts';
import { DEFAULT_RULE_CONTEXT, type SparkRuleContext } from './gh-rules.ts';
import type { RailsWanted } from './rails.ts';

export function rulesOf(context: SparkRuleContext | undefined): SparkRuleSet {
  return (context ?? DEFAULT_RULE_CONTEXT).rules;
}

export function holds(rules: SparkRuleSet, id: FloorRuleId): boolean {
  const effect = floorEffect(rules, id);
  return effect === 'ask' || effect === 'deny';
}

export function denies(rules: SparkRuleSet, id: FloorRuleId): boolean {
  return floorEffect(rules, id) === 'deny';
}

export function railsWith(rules: SparkRuleSet, effect: RuleEffect): RailsWanted {
  return (id) => floorEffect(rules, id) === effect;
}

export function heldForce(forced: ForcePush | null, rules: SparkRuleSet): ForcePush | null {
  if (!forced || !holds(rules, 'Push(force)')) return null;
  return forced;
}

export function ruleReject(reason: string, rule: FloorRuleId): Decision {
  return { verdict: 'reject', reason, rule };
}

export interface FloorAsks {
  forcePush: string[] | null;
  gitControl: string[];
  instructions: string[];
  secretSend: string[] | null;
}

export interface FloorReasons {
  forcePush: (branches: readonly string[]) => string;
  gitControl: string;
  instructions: string;
  secretSend: (files: readonly string[]) => string;
}

export function floorDenial(
  asks: FloorAsks,
  rules: SparkRuleSet,
  reasons: FloorReasons,
): Decision | null {
  if (asks.secretSend && denies(rules, 'SecretSend')) {
    return ruleReject(reasons.secretSend(asks.secretSend), 'SecretSend');
  }
  if (asks.forcePush && denies(rules, 'Push(force)')) {
    return ruleReject(reasons.forcePush(asks.forcePush), 'Push(force)');
  }
  if (asks.gitControl.length > 0 && denies(rules, 'GitConfig')) {
    return ruleReject(reasons.gitControl, 'GitConfig');
  }
  if (asks.instructions.length > 0 && denies(rules, 'InstructionFile(edit)')) {
    return ruleReject(reasons.instructions, 'InstructionFile(edit)');
  }
  return null;
}
