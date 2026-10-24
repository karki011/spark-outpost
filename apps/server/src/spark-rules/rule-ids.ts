export const FLOOR_RULE_IDS = [
  'Push',
  'Push(other)',
  'Push(force)',
  'PullRequest',
  'SecretFile(edit)',
  'SecretFile(read)',
  'InstructionFile(edit)',
  'GitConfig',
  'WriteOutside',
  'SecretSend',
  'GitRemote',
] as const;

export type FloorRuleId = (typeof FLOOR_RULE_IDS)[number];

export const GH_ANY = 'Gh(*)';

const GH_RULE = /^Gh\(([a-z][a-z0-9-]*) ([a-z][a-z0-9-]*)\)$/;
const FLOOR_IDS: ReadonlySet<string> = new Set(FLOOR_RULE_IDS);

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
