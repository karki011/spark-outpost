import { createRequire } from 'node:module';
import { Language, Parser, type Node } from 'web-tree-sitter';

export const DYNAMIC = '\u0001';

export interface ShellWord {
  text: string;
  dynamic: boolean;
  glob: boolean;
}

export interface ShellCommand {
  words: ShellWord[];
  assigns: boolean;
  piped: boolean;
}

export interface ShellRedirect {
  operator: string;
  target: ShellWord | null;
}

export interface ShellScript {
  commands: ShellCommand[];
  redirects: ShellRedirect[];
  unknown: string[];
}

type ShellParse = (command: string) => ShellScript;

const PASS_THROUGH = new Set([
  'program',
  'list',
  'pipeline',
  'do_group',
  'compound_statement',
  'subshell',
  'negated_command',
  'for_statement',
  'while_statement',
  'if_statement',
  'elif_clause',
  'else_clause',
  'case_statement',
  'case_item',
  'redirected_statement',
  'declaration_command',
  'variable_assignment',
  'variable_assignments',
  'test_command',
  'c_style_for_statement',
  'binary_expression',
  'unary_expression',
  'parenthesized_expression',
  'arithmetic_expansion',
  'herestring_redirect',
  'heredoc_redirect',
  'heredoc_body',
  'concatenation',
  'string',
  'expansion',
]);
const SKIPPED = new Set([
  'comment',
  'heredoc_start',
  'heredoc_end',
  'heredoc_content',
  'variable_name',
  'word',
  'raw_string',
  'string_content',
  'number',
  'simple_expansion',
  'special_variable_name',
  'file_descriptor',
  'test_operator',
  'regex',
  'extglob_pattern',
  'ansi_c_string',
  'translated_string',
]);
const NESTED = new Set(['command_substitution', 'process_substitution']);
const DYNAMIC_PARTS = new Set([
  'simple_expansion',
  'expansion',
  'command_substitution',
  'process_substitution',
  'arithmetic_expansion',
  'ansi_c_string',
  'translated_string',
]);
const UNQUOTED_GLOB = /[*?[]/;

function unescaped(text: string): string {
  return text.replace(/\\(.)/gs, '$1');
}

function wordOf(node: Node): ShellWord {
  switch (node.type) {
    case 'word':
    case 'number':
    case 'test_operator':
      return { text: unescaped(node.text), dynamic: false, glob: UNQUOTED_GLOB.test(node.text) };
    case 'raw_string':
      return { text: node.text.slice(1, -1), dynamic: false, glob: false };
    case 'string':
    case 'concatenation': {
      const parts = node.namedChildren.flatMap((child) => (child ? [wordOf(child)] : []));
      return {
        text: parts.map((part) => part.text).join(''),
        dynamic: parts.some((part) => part.dynamic),
        glob: parts.some((part) => part.glob),
      };
    }
    case 'string_content':
      return { text: node.text, dynamic: false, glob: false };
    default:
      return {
        text: DYNAMIC_PARTS.has(node.type) ? DYNAMIC : node.text,
        dynamic: true,
        glob: false,
      };
  }
}

function walk(node: Node, script: ShellScript, piped: boolean): void {
  if (node.type === 'ERROR' || node.isMissing) {
    script.unknown.push('unparsed');
    return;
  }
  if (node.type === 'command') {
    addCommand(node, script, piped);
    return;
  }
  if (node.type === 'file_redirect') {
    addRedirect(node, script);
    return;
  }
  if (NESTED.has(node.type)) {
    walkChildren(node, script, false);
    return;
  }
  if (PASS_THROUGH.has(node.type)) {
    walkChildren(node, script, node.type === 'pipeline' ? null : piped);
    return;
  }
  if (SKIPPED.has(node.type) || !node.isNamed) return;
  script.unknown.push(node.type);
}

function walkChildren(node: Node, script: ShellScript, piped: boolean | null): void {
  node.namedChildren.forEach((child, index) => {
    if (!child) return;
    walk(child, script, piped ?? index > 0);
  });
}

function nestedIn(node: Node, script: ShellScript): void {
  for (const child of node.namedChildren) {
    if (!child) continue;
    if (NESTED.has(child.type)) walk(child, script, false);
    else nestedIn(child, script);
  }
}

function addCommand(node: Node, script: ShellScript, piped: boolean): void {
  const words: ShellWord[] = [];
  let assigns = false;
  for (const child of node.namedChildren) {
    if (!child) continue;
    if (child.type === 'variable_assignment') {
      assigns = true;
      nestedIn(child, script);
    } else if (child.type === 'file_redirect') {
      addRedirect(child, script);
    } else if (child.type === 'herestring_redirect') {
      nestedIn(child, script);
    } else {
      const target = child.type === 'command_name' ? child.firstNamedChild : child;
      if (target) words.push(wordOf(target));
      if (NESTED.has(child.type)) walk(child, script, false);
      else nestedIn(child, script);
    }
  }
  script.commands.push({ words, assigns, piped });
}

function addRedirect(node: Node, script: ShellScript): void {
  const operator = node.children.find((child) => child && !child.isNamed)?.text ?? '';
  const destination = node.childForFieldName('destination');
  script.redirects.push({ operator, target: destination ? wordOf(destination) : null });
  if (destination) nestedIn(destination, script);
}

const require = createRequire(import.meta.url);
let loading: Promise<ShellParse> | null = null;

async function load(): Promise<ShellParse> {
  await Parser.init();
  const grammar = await Language.load(
    require.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter-bash.wasm'),
  );
  const parser = new Parser();
  parser.setLanguage(grammar);
  return (command) => {
    const script: ShellScript = { commands: [], redirects: [], unknown: [] };
    const tree = parser.parse(command);
    if (!tree) return { ...script, unknown: ['unparsed'] };
    try {
      walk(tree.rootNode, script, false);
      return script;
    } finally {
      tree.delete();
    }
  };
}

function shellParser(): Promise<ShellParse> {
  loading ??= load().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

export async function parseShell(command: string | null): Promise<ShellScript | null> {
  if (!command) return null;
  try {
    return (await shellParser())(command);
  } catch (error) {
    console.error('Could not parse a shell command', error);
    return null;
  }
}
