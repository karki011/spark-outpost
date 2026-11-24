import { createRequire } from 'node:module';
import { Language, Parser, type Node } from 'web-tree-sitter';

export type PsArg =
  | { kind: 'param'; name: string; colon: boolean; glued: boolean }
  | { kind: 'value'; text: string; quoted: boolean; glued: boolean; temp: boolean };

export interface PsRedirect {
  operator: string;
  target: string | null;
  quoted: boolean;
}

export interface PsCommand {
  name: string;
  args: PsArg[];
  redirects: PsRedirect[];
}

export type PsStep = { join: '|' | '&&' | '||' | ';' | null; command: PsCommand };

export type PsScript = PsStep[];

class Unreadable extends Error {}

const LOOKALIKE_QUOTES_AND_DASHES = /[‘-„–-―]/;
const UNSAFE_TOKEN = /[$@(){},;|&<>"'`\s]/;
const UNSAFE_EXPANDABLE = /[$`"]/;
const TEMP_VARIABLE = /^\$env:(TEMP|TMP)(?=$|[\\/])/i;
const NEGATIVE_NUMBER = /^-\d+$/;
const MERGES = new Set(['2>&1', '1>&2']);

interface Walk {
  source: string;
  covered: boolean[];
  steps: PsStep[];
  join: PsStep['join'];
}

function fail(): never {
  throw new Unreadable();
}

function cover(walk: Walk, node: Node): void {
  for (let index = node.startIndex; index < node.endIndex; index++) walk.covered[index] = true;
}

function children(node: Node): Node[] {
  return node.children.flatMap((child) => (child ? [child] : []));
}

function only(node: Node, type: string): Node {
  const [child, ...rest] = node.namedChildren;
  if (!child || rest.length > 0 || child.type !== type) fail();
  return child;
}

function stringValue(literal: Node): { text: string; temp: boolean } {
  const inner = only(literal, literal.namedChildren[0]?.type ?? '');
  const text = inner.text;
  if (inner.type === 'verbatim_string_characters' && inner.childCount === 0) {
    if (text.length < 2 || !text.startsWith("'") || !text.endsWith("'")) fail();
    return { text: text.slice(1, -1).replaceAll("''", "'"), temp: false };
  }
  if (inner.type !== 'expandable_string_literal') fail();
  if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) fail();
  const content = text.slice(1, -1);
  const temp = TEMP_VARIABLE.exec(content);
  const rest = temp ? content.slice(temp[0].length) : content;
  if (UNSAFE_EXPANDABLE.test(rest)) fail();
  return { text: rest, temp: temp !== null };
}

function expressionValue(node: Node): { text: string; quoted: boolean; temp: boolean } {
  const unary = only(node, 'unary_expression');
  const inner = unary.namedChildren[0];
  if (!inner || unary.namedChildren.length > 1) fail();
  if (inner.type === 'string_literal') return { ...stringValue(inner), quoted: true };
  if (inner.type === 'integer_literal' && /^\d+$/.test(inner.text)) {
    return { text: inner.text, quoted: false, temp: false };
  }
  if (inner.type === 'expression_with_unary_operator' && NEGATIVE_NUMBER.test(inner.text)) {
    return { text: inner.text, quoted: false, temp: false };
  }
  if (inner.type === 'variable' && /^\$(true|false)$/i.test(inner.text)) {
    return { text: inner.text.toLowerCase(), quoted: false, temp: false };
  }
  return fail();
}

function redirectOf(node: Node): PsRedirect {
  const merging = node.namedChildren.find(
    (child) => child?.type === 'merging_redirection_operator',
  );
  if (merging) {
    if (node.namedChildren.length !== 1 || !MERGES.has(merging.text)) fail();
    return { operator: merging.text, target: null, quoted: false };
  }
  const operator = node.childForFieldName('operator') ?? node.namedChildren[0];
  const file = node.namedChildren[1];
  if (!operator || operator.type !== 'file_redirection_operator' || !file) fail();
  if (file.type !== 'redirected_file_name') fail();
  const target = file.namedChildren.filter((child) => child?.type !== 'command_argument_sep');
  if (target.length !== 1 || !target[0]) fail();
  const value = target[0];
  if (value.type === 'generic_token') {
    if (UNSAFE_TOKEN.test(value.text)) fail();
    return { operator: operator.text, target: value.text, quoted: false };
  }
  if (value.type !== 'array_literal_expression') fail();
  const unary = only(value, 'unary_expression');
  const inner = unary.namedChildren[0];
  if (inner?.type === 'variable' && inner.text.toLowerCase() === '$null') {
    return { operator: operator.text, target: '/dev/null', quoted: false };
  }
  const literal = expressionValue(value);
  if (literal.temp) fail();
  return { operator: operator.text, target: literal.text, quoted: true };
}

function elementsOf(node: Node, command: PsCommand, walk: Walk): void {
  let previousEnd = -1;
  for (const child of children(node)) {
    if (child.type === 'command_argument_sep') {
      if (child.text.trim() === '') continue;
      const last = command.args[command.args.length - 1];
      if (child.text !== ':' || last?.kind !== 'param' || last.colon) fail();
      if (child.startIndex !== previousEnd) fail();
      last.colon = true;
      previousEnd = child.endIndex;
      cover(walk, child);
      continue;
    }
    const glued = child.startIndex === previousEnd;
    previousEnd = child.endIndex;
    cover(walk, child);
    if (child.type === 'generic_token') {
      if (UNSAFE_TOKEN.test(child.text)) fail();
      command.args.push({ kind: 'value', text: child.text, quoted: false, glued, temp: false });
    } else if (child.type === 'command_parameter') {
      const colon = child.text.endsWith(':');
      const name = colon ? child.text.slice(0, -1) : child.text;
      if (UNSAFE_TOKEN.test(name) || name.includes(':')) fail();
      command.args.push({ kind: 'param', name, colon, glued });
    } else if (child.type === 'array_literal_expression') {
      command.args.push({ kind: 'value', ...expressionValue(child), glued });
    } else if (child.type === 'redirection') {
      command.redirects.push(redirectOf(child));
    } else fail();
  }
}

function nameOf(node: Node): string {
  if (node.type === 'command_name') {
    if (node.childCount > 0 || UNSAFE_TOKEN.test(node.text)) fail();
    return node.text;
  }
  if (node.type !== 'command_name_expr') fail();
  const literal = only(node, 'string_literal');
  const value = stringValue(literal);
  if (value.temp) fail();
  return value.text;
}

function commandOf(node: Node, walk: Walk): PsCommand {
  const command: PsCommand = { name: '', args: [], redirects: [] };
  let named = false;
  for (const child of children(node)) {
    if (child.type === 'command_invokation_operator') {
      if (child.text !== '&' || named) fail();
      cover(walk, child);
    } else if (child.type === 'command_name' || child.type === 'command_name_expr') {
      if (named) fail();
      command.name = nameOf(child);
      named = true;
      cover(walk, child);
    } else if (child.type === 'command_elements') {
      elementsOf(child, command, walk);
    } else fail();
  }
  if (!named || !command.name) fail();
  return command;
}

function pipelineOf(node: Node, walk: Walk): void {
  for (const child of children(node)) {
    if (child.type === 'command') {
      walk.steps.push({ join: walk.join, command: commandOf(child, walk) });
      walk.join = null;
    } else if (child.type === 'pipeline_chain' || child.type === 'pipeline_chain_tail') {
      pipelineOf(child, walk);
    } else if (child.type === '|' || child.type === '&&' || child.type === '||') {
      if (walk.join !== null || walk.steps.length === 0) fail();
      walk.join = child.type;
      cover(walk, child);
    } else fail();
  }
}

function statementsOf(node: Node, walk: Walk): void {
  for (const child of children(node)) {
    if (child.type === 'comment') cover(walk, child);
    else if (child.type === 'empty_statement') {
      if (child.text !== ';') fail();
      cover(walk, child);
    } else if (child.type === 'pipeline') {
      if (walk.steps.length > 0) walk.join = ';';
      pipelineOf(child, walk);
      if (walk.join !== null) fail();
    } else if (child.type === 'statement_list') statementsOf(child, walk);
    else fail();
  }
}

function hasErrors(node: Node): boolean {
  return node.hasError || node.isMissing;
}

function fullyCovered(walk: Walk): boolean {
  for (let index = 0; index < walk.source.length; index++) {
    if (!walk.covered[index] && !/\s/.test(walk.source[index]!)) return false;
  }
  return true;
}

type PsParse = (script: string) => PsScript | null;

const require = createRequire(import.meta.url);
let loading: Promise<PsParse> | null = null;

async function load(): Promise<PsParse> {
  await Parser.init();
  const grammar = await Language.load(
    require.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter-powershell.wasm'),
  );
  const parser = new Parser();
  parser.setLanguage(grammar);
  return (script) => {
    if (LOOKALIKE_QUOTES_AND_DASHES.test(script)) return null;
    const tree = parser.parse(script);
    if (!tree) return null;
    try {
      if (hasErrors(tree.rootNode)) return null;
      const walk: Walk = { source: script, covered: [], steps: [], join: null };
      statementsOf(tree.rootNode, walk);
      return walk.steps.length > 0 && fullyCovered(walk) ? walk.steps : null;
    } catch (error) {
      if (error instanceof Unreadable) return null;
      throw error;
    } finally {
      tree.delete();
    }
  };
}

export async function parsePowerShell(script: string): Promise<PsScript | null> {
  loading ??= load().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  try {
    return (await loading)(script);
  } catch (error) {
    console.error('Could not parse a PowerShell command', error);
    return null;
  }
}
