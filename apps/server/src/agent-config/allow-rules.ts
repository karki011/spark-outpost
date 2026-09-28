import path from 'node:path';
import {
  hasControlOperators,
  normalizeCommand,
  publishesCode,
  splitSimpleCommands,
} from '../approvals/commands.ts';
import { isSecretPath } from '../projects/path-policy.ts';
import { SECRET_FILE_PATTERNS } from '../projects/secret-files.ts';

export interface AllowRuleVerdict {
  rule: string;
  applied: boolean;
  reason: string | null;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const EVERYTHING = new Set(['', '*', '**', ':*']);
const COMMAND_RUNNERS = new Set([
  'bash',
  'sh',
  'zsh',
  'fish',
  'dash',
  'ksh',
  'eval',
  'source',
  '.',
  'sudo',
  'command',
  'exec',
  'nohup',
  'time',
  'env',
  'xargs',
]);
const PUBLISH_COMMANDS = [
  'git push',
  'git remote add',
  'git remote set-url',
  'git remote remove',
  'git remote rm',
  'git remote rename',
  'git send-email',
  'git request-pull',
  'gh',
  'hub',
  'glab',
  'tea',
];
const SECRET_SAMPLES = SECRET_FILE_PATTERNS.map((pattern) => pattern.replace(/\*/g, 'x'));
const RULE = /^([A-Za-z0-9_]+)(?:\((.*)\))?$/s;

const applied = (rule: string): AllowRuleVerdict => ({ rule, applied: true, reason: null });
const dropped = (rule: string, reason: string): AllowRuleVerdict => ({
  rule,
  applied: false,
  reason,
});

export function commandPrefix(spec: string): string {
  const trimmed = spec.trim();
  const withoutWildcard = trimmed.endsWith(':*')
    ? trimmed.slice(0, -2)
    : trimmed.replace(/\s*\*$/, '');
  return normalizeCommand(withoutWildcard);
}

function globMatches(glob: string, name: string): boolean {
  const source = glob
    .split('')
    .map((char) => {
      if (char === '*') return '.*';
      if (char === '?') return '.';
      return char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${source}$`, 'i').test(name);
}

function namesSecretFiles(spec: string): boolean {
  const last = spec.replace(/\/+$/, '').split('/').pop() ?? '';
  if (/^\*+$/.test(last)) return false;
  if (/[*?]/.test(last)) return SECRET_SAMPLES.some((sample) => globMatches(last, sample));
  return isSecretPath(last);
}

function leavesProject(spec: string): boolean {
  const trimmed = spec.trim();
  if (trimmed.startsWith('/') || trimmed.startsWith('~')) return true;
  return trimmed.split('/').includes('..');
}

function publishes(prefix: string): boolean {
  if (publishesCode(prefix)) return true;
  return PUBLISH_COMMANDS.some((command) => command === prefix || command.startsWith(`${prefix} `));
}

function bashVerdict(rule: string, spec: string): AllowRuleVerdict {
  const prefix = commandPrefix(spec);
  if (EVERYTHING.has(prefix)) return dropped(rule, 'Allows every command');
  if (prefix.includes('*')) return dropped(rule, 'Has a wildcard in the middle');
  if (hasControlOperators(prefix)) return dropped(rule, 'Chains or redirects commands');
  const program = path.basename(splitSimpleCommands(prefix)[0]?.[0] ?? '');
  if (COMMAND_RUNNERS.has(program)) return dropped(rule, 'Can run any command');
  if (publishes(prefix)) return dropped(rule, 'Could push code or change remotes');
  return applied(rule);
}

export function classifyAllowRule(rule: string): AllowRuleVerdict {
  const match = RULE.exec(rule.trim());
  if (!match) return dropped(rule, 'Not a rule Spark Outpost understands');
  const tool = match[1]!;
  const spec = match[2];
  const broad = spec === undefined || EVERYTHING.has(spec.trim());
  if (tool === 'Bash')
    return broad ? dropped(rule, 'Allows every command') : bashVerdict(rule, spec!);
  if (EDIT_TOOLS.has(tool)) {
    if (broad) return dropped(rule, `Allows every ${tool} call`);
    if (leavesProject(spec!)) return dropped(rule, 'Writes outside the project');
    if (namesSecretFiles(spec!)) return dropped(rule, 'Could change secret files');
    return applied(rule);
  }
  if (tool === 'Read' && spec !== undefined && namesSecretFiles(spec)) {
    return dropped(rule, 'Could read secret files');
  }
  return applied(rule);
}

export function appliedAllowRules(rules: readonly string[]): string[] {
  const kept = rules.filter((rule) => classifyAllowRule(rule).applied);
  return [...new Set(kept)];
}

export function commandAllowlistFromRules(rules: readonly string[]): string[] {
  const entries = appliedAllowRules(rules).flatMap((rule) => {
    const match = RULE.exec(rule.trim());
    if (!match || match[1] !== 'Bash' || match[2] === undefined) return [];
    return [commandPrefix(match[2])];
  });
  return [...new Set(entries)];
}
