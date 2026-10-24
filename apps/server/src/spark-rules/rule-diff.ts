import type { RuleLine } from '@spark-outpost/contracts';
import { recognisedRule } from './rule-ids.ts';
import { RULE_EFFECTS, type RuleChange, type RuleLists } from './rules-file.ts';

export interface RuleDiff {
  add: RuleLine[];
  remove: RuleLine[];
}

function key(line: RuleLine): string {
  return `${line.effect}\u0000${line.rule}`;
}

function unique(lines: readonly RuleLine[]): RuleLine[] {
  const seen = new Map(lines.map((line) => [key(line), line]));
  return [...seen.values()];
}

export function unrecognisedRules(lines: readonly RuleLine[]): string[] {
  return [...new Set(lines.filter((line) => !recognisedRule(line.rule)).map((line) => line.rule))];
}

export function effectiveDiff(
  lists: RuleLists,
  add: readonly RuleLine[],
  remove: readonly RuleLine[],
): RuleDiff {
  const adding = new Set(add.map(key));
  const removing = new Set(remove.map(key));
  const kept = add.filter((line) => !removing.has(key(line)));
  const moved = kept.flatMap((line) =>
    RULE_EFFECTS.filter((effect) => effect !== line.effect).map((effect) => ({
      effect,
      rule: line.rule,
    })),
  );
  const present = (line: RuleLine) => lists[line.effect].includes(line.rule);
  return {
    add: unique(kept).filter((line) => !present(line)),
    remove: unique([...remove, ...moved]).filter((line) => present(line) && !adding.has(key(line))),
  };
}

export function ruleChangeOf(diff: RuleDiff): RuleChange {
  return {
    add: diff.add.map((line) => [line.effect, line.rule] as const),
    remove: diff.remove.map((line) => [line.effect, line.rule] as const),
  };
}

export function listsDiff(before: RuleLists, after: RuleLists): RuleDiff {
  const lines = (lists: RuleLists) =>
    RULE_EFFECTS.flatMap((effect) => lists[effect].map((rule) => ({ effect, rule })));
  const has = (lists: RuleLists, line: RuleLine) => lists[line.effect].includes(line.rule);
  return {
    add: lines(after).filter((line) => !has(before, line)),
    remove: lines(before).filter((line) => !has(after, line)),
  };
}

export function diffLine(diff: RuleDiff): string {
  const lines = [
    ...diff.add.map((line) => `+ ${line.effect} ${line.rule}`),
    ...diff.remove.map((line) => `− ${line.effect} ${line.rule}`),
  ];
  return lines.join('; ');
}
