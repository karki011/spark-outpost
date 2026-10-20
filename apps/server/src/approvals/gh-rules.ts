import {
  WORKFLOW_PREFIXES,
  type GhRuleChoice,
  type SparkRuleRefusal,
} from '@spark-outpost/contracts';
import { normalizeCommand, programName } from './commands.ts';
import { hostingCommands, hostingRead, publishesThroughGit } from './git-commands.ts';

export interface GhRules {
  workflows: GhRuleChoice;
  allowed: readonly string[];
  once: readonly string[];
}

export const NO_GH_RULES: GhRules = { workflows: 'refused', allowed: [], once: [] };

export type GhStanding = 'read' | 'policy' | 'follows' | 'refused';

export type GhRuling =
  | { kind: 'none' }
  | { kind: 'follows' }
  | { kind: 'refused'; rule: SparkRuleRefusal; reason: string };

const NONE: GhRuling = { kind: 'none' };
const FIXED_GROUPS = new Set(['api', 'auth']);
const PUBLISH_RULED: Readonly<Record<string, ReadonlySet<string>>> = {
  pr: new Set(['create', 'edit', 'comment']),
};
const APPROVES = /^(?:-a|--approve(?:=.*)?|-[a-zA-Z]*a[a-zA-Z]*)$/;
const ADMIN = /^--admin(?:=.*)?$/;

type Program = readonly string[];

function prefixOf(args: readonly string[]): string | null {
  const [group, verb] = args;
  if (!group || !verb || group.startsWith('-') || verb.startsWith('-')) return null;
  return `gh ${group} ${verb}`.toLowerCase();
}

function neverAllowed(args: readonly string[]): boolean {
  const [group = '', verb = '', ...rest] = args;
  if (FIXED_GROUPS.has(group)) return true;
  if (args.some((token) => ADMIN.test(token))) return true;
  if (group === 'pr' && verb === 'merge') return true;
  return group === 'pr' && verb === 'review' && rest.some((token) => APPROVES.test(token));
}

function workflowPrefix(prefix: string): boolean {
  return (WORKFLOW_PREFIXES as readonly string[]).includes(prefix);
}

function allowedByRule(prefix: string, rules: GhRules, once: boolean): boolean {
  if (once) return true;
  if (workflowPrefix(prefix)) return rules.workflows === 'mode';
  return rules.allowed.includes(prefix);
}

export function ghStanding(program: Program, rules: GhRules, once = false): GhStanding {
  if (programName(program) !== 'gh') return 'policy';
  if (hostingRead(program)) return 'read';
  const args = program.slice(1);
  const prefix = prefixOf(args);
  if (!prefix || neverAllowed(args)) return 'policy';
  if (allowedByRule(prefix, rules, once)) return 'follows';
  const [group = '', verb = ''] = args;
  return PUBLISH_RULED[group]?.has(verb) ? 'policy' : 'refused';
}

export function ruleSettingReason(rule: SparkRuleRefusal): string {
  const setting =
    rule.group === 'workflows'
      ? '"Run a workflow" is Refused'
      : `${rule.prefix} is not an allowed command`;
  return `${rule.prefix} is refused by Spark rules: ${setting} in Settings → Spark rules`;
}

export function sparkRuleReason(rule: SparkRuleRefusal): string {
  return `${ruleSettingReason(rule)}. The user has a card in this chat to allow it; if they do, Spark tells you to run it again. Don't try another way; if the work needs it, end with "Needs you: allow ${rule.prefix} in Spark rules"`;
}

function refusalOf(program: Program): SparkRuleRefusal {
  const prefix = prefixOf(program.slice(1)) ?? 'gh';
  return { group: workflowPrefix(prefix) ? 'workflows' : 'other', prefix };
}

export function onceFor(command: string, rules: GhRules): boolean {
  return rules.once.includes(normalizeCommand(command));
}

export function followsRule(program: Program, command: string, rules: GhRules): boolean {
  return ghStanding(program, rules, onceFor(command, rules)) === 'follows';
}

export function ghRuling(command: string, rules: GhRules): GhRuling {
  const once = onceFor(command, rules);
  const writes = hostingCommands(command).filter(
    (program) => ghStanding(program, rules, once) !== 'read',
  );
  if (writes.length === 0) return NONE;
  const standings = writes.map((program) => ghStanding(program, rules, once));
  if (standings.includes('policy')) return NONE;
  const refused = writes.find((program) => ghStanding(program, rules, once) === 'refused');
  if (!refused) return publishesThroughGit(command) ? NONE : { kind: 'follows' };
  const rule = refusalOf(refused);
  return { kind: 'refused', rule, reason: sparkRuleReason(rule) };
}

export function followsAny(command: string, rules: GhRules): boolean {
  return hostingCommands(command).some((program) => followsRule(program, command, rules));
}
