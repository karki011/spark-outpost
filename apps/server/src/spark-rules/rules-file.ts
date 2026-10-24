import { isRecord } from '../agent-config/records.ts';
import { recognisedRule } from './rule-ids.ts';

export const RULE_EFFECTS = ['allow', 'ask', 'deny'] as const;
export type RuleEffect = (typeof RULE_EFFECTS)[number];
export type RuleLists = Readonly<Record<RuleEffect, readonly string[]>>;

export const NO_RULE_LISTS: RuleLists = { allow: [], ask: [], deny: [] };

export interface ParsedRules {
  lists: RuleLists;
  problems: string[];
  malformed: boolean;
}

export const MAX_RULES = 200;
export const MAX_RULE_LENGTH = 512;
const KNOWN_KEYS: ReadonlySet<string> = new Set(['permissions']);
const KNOWN_PERMISSION_KEYS: ReadonlySet<string> = new Set(RULE_EFFECTS);

export class RulesFileError extends Error {}

function malformed(problem: string): ParsedRules {
  return { lists: NO_RULE_LISTS, problems: [problem], malformed: true };
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function unknownKeys(record: Record<string, unknown>, known: ReadonlySet<string>, at: string) {
  return Object.keys(record)
    .filter((key) => !known.has(key))
    .map((key) => `${at}"${key}" is kept but Spark doesn't use it`);
}

function describe(entry: unknown): string {
  return typeof entry === 'string' ? `"${entry.slice(0, 80)}"` : 'An entry that is not text';
}

function readList(entries: readonly unknown[], effect: RuleEffect, problems: string[]): string[] {
  const applied: string[] = [];
  for (const entry of entries.slice(0, MAX_RULES)) {
    if (typeof entry === 'string' && entry.length <= MAX_RULE_LENGTH && recognisedRule(entry)) {
      if (!applied.includes(entry)) applied.push(entry);
    } else {
      problems.push(`${describe(entry)} in ${effect} isn't a Spark rule, so it is not applied`);
    }
  }
  if (entries.length > MAX_RULES) {
    problems.push(`${effect} holds more than ${MAX_RULES} rules; the rest are not applied`);
  }
  return applied;
}

export function parseRulesFile(text: string): ParsedRules {
  const parsed = parsedJson(text);
  if (!isRecord(parsed)) return malformed('The file is not a JSON object');
  const problems = unknownKeys(parsed, KNOWN_KEYS, '');
  const permissions = parsed.permissions ?? {};
  if (!isRecord(permissions)) return malformed('"permissions" is not an object');
  problems.push(...unknownKeys(permissions, KNOWN_PERMISSION_KEYS, 'permissions.'));
  const lists: Record<RuleEffect, string[]> = { allow: [], ask: [], deny: [] };
  for (const effect of RULE_EFFECTS) {
    const entries = permissions[effect] ?? [];
    if (!Array.isArray(entries)) return malformed(`"permissions.${effect}" is not a list`);
    lists[effect] = readList(entries, effect, problems);
  }
  return { lists, problems, malformed: false };
}

export interface RuleChange {
  add?: readonly (readonly [RuleEffect, string])[];
  remove?: readonly (readonly [RuleEffect, string])[];
}

function editableFile(text: string | null): Record<string, unknown> {
  if (text === null) return {};
  const parsed = parsedJson(text);
  if (!isRecord(parsed) || parseRulesFile(text).malformed) {
    throw new RulesFileError("Spark's settings.json can't be read. Fix the file first.");
  }
  return parsed;
}

function listOf(permissions: Record<string, unknown>, effect: RuleEffect): unknown[] {
  const list = permissions[effect];
  return Array.isArray(list) ? [...list] : [];
}

export function changedRulesText(text: string | null, change: RuleChange): string {
  const file = editableFile(text);
  const permissions = isRecord(file.permissions) ? { ...file.permissions } : {};
  for (const effect of RULE_EFFECTS) {
    const removed = new Set(
      change.remove?.flatMap(([from, rule]) => (from === effect ? [rule] : [])),
    );
    const kept = listOf(permissions, effect).filter(
      (entry) => typeof entry !== 'string' || !removed.has(entry),
    );
    for (const [to, rule] of change.add ?? []) {
      if (to === effect && !kept.includes(rule)) kept.push(rule);
    }
    permissions[effect] = kept;
  }
  return `${JSON.stringify({ ...file, permissions }, null, 2)}\n`;
}
