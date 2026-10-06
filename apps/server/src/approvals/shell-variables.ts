import { heredocBodySpans } from './inline-code.ts';
import { shellStatements, type ShellStatement, type VariableUse } from './shell-statements.ts';

interface Known {
  value: string;
  from: number;
}

const ASSIGNMENT = /^([A-Za-z_]\w*)(\+?)=(.*)$/s;
const NAME = /^[A-Za-z_]\w*$/;
const SAFE_VALUE = /^[\w@%+=:,./-]+$/;
const VALUE_USE = /\$(?:([A-Za-z_]\w*)(?![\w[:(])|\{([A-Za-z_]\w*)\})/g;
const QUICK_ASSIGNMENT = /[A-Za-z_]\w*=/;
const REASSIGNERS = new Set([
  ...['read', 'declare', 'local', 'typeset', 'readonly', 'mapfile', 'readarray', 'getopts'],
  ...['printf', 'unset', 'for', 'select', 'let', 'integer', 'float'],
]);
const NESTING = new Set(['if', 'for', 'while', 'until', 'case', 'select', 'function', '{', '[[']);
const REWRITERS = new Set(['eval', 'source', '.']);
const LEADERS = new Set([
  ...['{', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', 'time'],
  ...['command', 'builtin', 'exec'],
]);
const UNCONDITIONAL_ENDS = new Set([';', '\n', '&&', '']);

function assignmentOf(raw: string): { name: string; appends: boolean; value: string } | null {
  const match = ASSIGNMENT.exec(raw);
  return match ? { name: match[1]!, appends: match[2] === '+', value: match[3]! } : null;
}

function firstProgram(statement: ShellStatement): string | null {
  const word = statement.words.find((candidate) => assignmentOf(candidate.raw) === null);
  return word?.raw ?? null;
}

function ledProgram(statement: ShellStatement): string | null {
  const word = statement.words.find(
    (candidate) => assignmentOf(candidate.raw) === null && !LEADERS.has(candidate.raw),
  );
  return word?.raw ?? null;
}

function literalValue(raw: string, known: ReadonlyMap<string, Known>): string | null {
  if (raw.includes('\\') || raw.includes('`')) return null;
  if (raw.includes("'")) {
    const single = /^'([^']*)'$/.exec(raw)?.[1];
    return single !== undefined && SAFE_VALUE.test(single) ? single : null;
  }
  const expanded = raw.replace(
    VALUE_USE,
    (whole, bare?: string, braced?: string) => known.get(bare ?? braced ?? '')?.value ?? whole,
  );
  const value = /^"([^"]*)"$/.exec(expanded)?.[1] ?? expanded;
  return SAFE_VALUE.test(value) ? value : null;
}

function unsettled(statements: readonly ShellStatement[], command: string): Set<string> | null {
  const counts = new Map<string, number>();
  const names = new Set<string>();
  for (const statement of statements) {
    if (REWRITERS.has(ledProgram(statement) ?? '')) return null;
    for (const word of statement.words) {
      const assigned = assignmentOf(word.raw);
      if (assigned) counts.set(assigned.name, (counts.get(assigned.name) ?? 0) + 1);
    }
    if (!statement.words.some((word) => REASSIGNERS.has(word.raw))) continue;
    for (const word of statement.words) {
      const name = word.raw.replace(/^["']|["']$/g, '').split('=')[0]!;
      if (NAME.test(name)) names.add(name);
    }
  }
  if (counts.has('IFS')) return null;
  for (const [name, count] of counts) {
    if (count > 1 || new RegExp(`\\$\\{${name}:?=`).test(command)) names.add(name);
  }
  return names;
}

function assignsOnly(statement: ShellStatement): boolean {
  const words = statement.words[0]?.raw === 'export' ? statement.words.slice(1) : statement.words;
  return words.length > 0 && words.every((word) => assignmentOf(word.raw)?.appends === false);
}

function knownValues(
  statements: readonly ShellStatement[],
  uses: readonly VariableUse[],
  unsettledNames: ReadonlySet<string>,
): Map<string, Known> {
  const known = new Map<string, Known>();
  let nested = false;
  let previousKept = false;
  for (const statement of statements) {
    const program = firstProgram(statement);
    if (program !== null && NESTING.has(program)) nested = true;
    const unconditional: boolean =
      statement.after === '&&' ? previousKept : UNCONDITIONAL_ENDS.has(statement.after);
    const kept: boolean =
      !nested &&
      statement.depth === 0 &&
      statement.plain &&
      unconditional &&
      UNCONDITIONAL_ENDS.has(statement.endedBy) &&
      assignsOnly(statement);
    previousKept = kept;
    if (!kept) continue;
    for (const word of statement.words) {
      const assigned = assignmentOf(word.raw);
      if (!assigned || unsettledNames.has(assigned.name)) continue;
      const usedEarlier = uses.some(
        (use) => use.name === assigned.name && use.start < statement.end,
      );
      const value = usedEarlier ? null : literalValue(assigned.value, known);
      if (value !== null) known.set(assigned.name, { value, from: statement.end });
    }
  }
  return known;
}

export function resolveVariables(command: string): string {
  if (!command.includes('$') || !QUICK_ASSIGNMENT.test(command)) return command;
  const scanned = shellStatements(command, heredocBodySpans(command));
  if (!scanned) return command;
  const unsettledNames = unsettled(scanned.statements, command);
  if (!unsettledNames) return command;
  const known = knownValues(scanned.statements, scanned.uses, unsettledNames);
  if (known.size === 0) return command;
  let resolved = '';
  let copied = 0;
  for (const use of scanned.uses) {
    const value = known.get(use.name);
    if (!value || !use.plain || use.start < value.from) continue;
    resolved += command.slice(copied, use.start) + value.value;
    copied = use.end;
  }
  return resolved + command.slice(copied);
}

export function withResolvedVariables<Request extends { command: string | null }>(
  request: Request,
): Request {
  if (!request.command) return request;
  const command = resolveVariables(request.command);
  return command === request.command ? request : { ...request, command };
}
