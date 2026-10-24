import { WORKFLOW_PREFIXES, type SparkRuleRefusal } from '@spark-outpost/contracts';
import { WORKFLOWS_REFUSED_RULES } from '../spark-rules/recommended.ts';
import type { FloorRuleId } from '../spark-rules/rule-ids.ts';
import {
  ghCommandRuling,
  ghExactRuling,
  type RuleRuling,
  type SparkRuleSet,
} from '../spark-rules/resolve.ts';
import { normalizeCommand, programName } from './commands.ts';
import { ghArgs, ghRevealsToken } from './gh-reads.ts';
import { hostingCommands, hostingRead, publishesThroughGit } from './git-commands.ts';

export interface SparkRuleContext {
  rules: SparkRuleSet;
  once: readonly string[];
}

export const DEFAULT_RULE_CONTEXT: SparkRuleContext = { rules: WORKFLOWS_REFUSED_RULES, once: [] };

export type GhStanding = 'read' | 'policy' | 'follows' | 'asks' | 'refused';

export type GhRuling =
  | { kind: 'none' }
  | { kind: 'follows' }
  | { kind: 'asks'; reason: string; ruleId: string }
  | { kind: 'refused'; rule: SparkRuleRefusal | null; reason: string; ruleId: string };

const NONE: GhRuling = { kind: 'none' };
const PUBLISH_RULED: Readonly<Record<string, ReadonlySet<string>>> = {
  pr: new Set(['create', 'edit', 'comment']),
};
const APPROVES = /^(?:-a|--approve(?:=.*)?|-[a-zA-Z]*a[a-zA-Z]*)$/;
const ADMIN = /^--admin(?:=.*)?$/;

type Program = readonly string[];

function prefixOf(given: readonly string[]): string | null {
  const [group, verb] = ghArgs(given);
  if (!group || !verb || group.startsWith('-') || verb.startsWith('-')) return null;
  return `gh ${group} ${verb}`.toLowerCase();
}

export function ownGhRules(args: readonly string[]): FloorRuleId[] {
  const [group = '', verb = '', ...rest] = ghArgs(args);
  const found: FloorRuleId[] = [];
  if (group === 'api') found.push('Gh(api write)');
  if (group === 'auth' && !ghRevealsToken(args)) found.push('Gh(auth)');
  if (group === 'pr' && verb === 'merge') found.push('Gh(pr merge)');
  if (group === 'pr' && verb === 'review' && rest.some((token) => APPROVES.test(token))) {
    found.push('Gh(pr review)');
  }
  if (args.some((token) => ADMIN.test(token))) found.push('GhAdmin');
  return found;
}

function workflowPrefix(prefix: string): boolean {
  return (WORKFLOW_PREFIXES as readonly string[]).includes(prefix);
}

function standingOf(ruling: RuleRuling | null): GhStanding {
  if (ruling?.effect === 'deny') return 'refused';
  return ruling?.effect === 'ask' ? 'asks' : 'follows';
}

function rulingFor(prefix: string, rules: SparkRuleContext): RuleRuling | null {
  const [, group = '', verb = ''] = prefix.split(' ');
  return PUBLISH_RULED[group]?.has(verb)
    ? ghExactRuling(rules.rules, prefix)
    : ghCommandRuling(rules.rules, prefix);
}

export function ghStanding(program: Program, rules: SparkRuleContext, once = false): GhStanding {
  if (programName(program) !== 'gh') return 'policy';
  if (hostingRead(program)) return 'read';
  const args = ghArgs(program.slice(1));
  const prefix = prefixOf(args);
  if (!prefix || ownGhRules(args).length > 0) return 'policy';
  if (once) return 'follows';
  const ruling = rulingFor(prefix, rules);
  const [group = '', verb = ''] = args;
  if (PUBLISH_RULED[group]?.has(verb) && !ruling) return 'policy';
  return standingOf(ruling);
}

export function ruleSettingReason(rule: SparkRuleRefusal): string {
  const setting =
    rule.group === 'workflows'
      ? '"Run a workflow" is set to Refuse'
      : `${rule.prefix} is not an allowed command`;
  return `${rule.prefix} is refused by Spark rules: ${setting} in Settings → Spark rules`;
}

export function sparkRuleReason(rule: SparkRuleRefusal): string {
  return `${ruleSettingReason(rule)}. The user has a card in this chat to allow it; if they do, Spark tells you to run it again. Don't try another way; if the work needs it, end with "Needs you: allow ${rule.prefix} in Spark rules"`;
}

export function managedRuleReason(subject: string, ruleId: string): string {
  return `${subject} is refused by your company's Spark rules (${ruleId} in managed-settings.json). Don't try another way; tell the user it needs their company's permission`;
}

export function ruleAskReason(subject: string, ruleId: string): string {
  return `Spark rules ask before ${subject} (${ruleId})`;
}

function prefixFor(program: Program): string {
  return prefixOf(program.slice(1)) ?? 'gh';
}

function refusalOf(program: Program, rules: SparkRuleContext): GhRuling {
  const prefix = prefixFor(program);
  const ruling = rulingFor(prefix, rules);
  const ruleId = ruling?.id ?? prefix;
  if (ruling?.tier === 'managed') {
    return { kind: 'refused', rule: null, reason: managedRuleReason(prefix, ruleId), ruleId };
  }
  const rule: SparkRuleRefusal = { group: workflowPrefix(prefix) ? 'workflows' : 'other', prefix };
  return { kind: 'refused', rule, reason: sparkRuleReason(rule), ruleId };
}

function askingOf(program: Program, rules: SparkRuleContext): GhRuling {
  const prefix = prefixFor(program);
  const ruleId = rulingFor(prefix, rules)?.id ?? prefix;
  return { kind: 'asks', reason: ruleAskReason(prefix, ruleId), ruleId };
}

export function onceFor(command: string, rules: SparkRuleContext): boolean {
  return rules.once.includes(normalizeCommand(command));
}

function liftedBy(standing: GhStanding): boolean {
  return standing === 'follows' || standing === 'asks';
}

export function followsRule(program: Program, command: string, rules: SparkRuleContext): boolean {
  return liftedBy(ghStanding(program, rules, onceFor(command, rules)));
}

export function ghRuling(command: string, rules: SparkRuleContext): GhRuling {
  const once = onceFor(command, rules);
  const writes = hostingCommands(command).filter(
    (program) => ghStanding(program, rules, once) !== 'read',
  );
  if (writes.length === 0) return NONE;
  const standings = writes.map((program) => ghStanding(program, rules, once));
  if (standings.includes('policy')) return NONE;
  const refused = writes.find((program) => ghStanding(program, rules, once) === 'refused');
  if (refused) return refusalOf(refused, rules);
  const asking = writes.find((program) => ghStanding(program, rules, once) === 'asks');
  if (asking) return askingOf(asking, rules);
  return publishesThroughGit(command) ? NONE : { kind: 'follows' };
}

export function followsAny(command: string, rules: SparkRuleContext): boolean {
  return hostingCommands(command).some((program) => followsRule(program, command, rules));
}
