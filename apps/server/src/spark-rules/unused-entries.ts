import type { UnusedRuleEntry } from '@spark-outpost/contracts';
import { isRecord } from '../agent-config/records.ts';
import { recognisedRule } from './rule-ids.ts';
import { MAX_RULE_LENGTH, MAX_RULES, RULE_EFFECTS } from './rules-file.ts';

const PREVIEW = 80;
const AGENT_TOOL_RULE =
  /^(?:[A-Z]\w*\(.*\)|mcp__.+|Bash|Read|Edit|MultiEdit|Write|NotebookEdit|WebFetch|WebSearch|Glob|Grep|Agent|Task)$/s;
const SPARK_RULE_NAME =
  /^(?:Push|PullRequest|SecretFile|InstructionFile|GitConfig|WriteOutside|SecretSend|GitRemote|Gh)\b/;
const KNOWN_EFFECTS: ReadonlySet<string> = new Set(RULE_EFFECTS);

function clipped(text: string): string {
  return text.length > PREVIEW ? `${text.slice(0, PREVIEW)}…` : text;
}

function keyEntry(key: string, value: unknown): UnusedRuleEntry {
  const shown = JSON.stringify(value) ?? 'null';
  return { entry: clipped(`${JSON.stringify(key)}: ${shown}`), kind: 'key' };
}

function ruleEntry(entry: unknown): UnusedRuleEntry {
  if (typeof entry !== 'string')
    return { entry: clipped(JSON.stringify(entry) ?? ''), kind: 'rule' };
  const shown = clipped(JSON.stringify(entry));
  const agentTool =
    entry.length <= MAX_RULE_LENGTH && AGENT_TOOL_RULE.test(entry) && !SPARK_RULE_NAME.test(entry);
  return { entry: shown, kind: agentTool ? 'agent-tool' : 'rule' };
}

function listEntries(list: unknown): UnusedRuleEntry[] {
  if (!Array.isArray(list)) return [];
  const unused = list
    .slice(0, MAX_RULES)
    .filter(
      (entry) =>
        typeof entry !== 'string' || entry.length > MAX_RULE_LENGTH || !recognisedRule(entry),
    );
  return unused.map(ruleEntry);
}

export function unusedEntries(text: string): UnusedRuleEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  const unused = Object.entries(parsed)
    .filter(([key]) => key !== 'permissions')
    .map(([key, value]) => keyEntry(key, value));
  const permissions = parsed.permissions;
  if (!isRecord(permissions)) return unused;
  for (const [key, value] of Object.entries(permissions)) {
    if (KNOWN_EFFECTS.has(key)) unused.push(...listEntries(value));
    else unused.push(keyEntry(`permissions.${key}`, value));
  }
  return unused;
}
