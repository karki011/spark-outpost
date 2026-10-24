import { RECOMMENDED_RULES } from './recommended.ts';
import { floorEffect, type SparkRuleSet } from './resolve.ts';
import type { FloorRuleId } from './rule-ids.ts';

export type FlagEffect = 'ask' | 'deny' | null;

export interface SparkFloor {
  secretEdits: boolean;
  forcePush: boolean;
  remotes: FlagEffect;
  instructions: FlagEffect;
  gitConfig: FlagEffect;
}

function flagEffect(rules: SparkRuleSet, id: FloorRuleId): FlagEffect {
  const effect = floorEffect(rules, id);
  return effect === 'ask' || effect === 'deny' ? effect : null;
}

export function sparkFloor(rules: SparkRuleSet): SparkFloor {
  return {
    secretEdits: flagEffect(rules, 'SecretFile(edit)') !== null,
    forcePush: flagEffect(rules, 'Push(force)') !== null,
    remotes: flagEffect(rules, 'GitRemote'),
    instructions: flagEffect(rules, 'InstructionFile(edit)'),
    gitConfig: flagEffect(rules, 'GitConfig'),
  };
}

export const RECOMMENDED_FLOOR: SparkFloor = sparkFloor(RECOMMENDED_RULES);
