import { createRequire } from 'node:module';
import { Language, Parser, Query, type Node } from 'web-tree-sitter';
import type { SymbolLanguage } from './languages.ts';
import {
  definitionKind,
  definitionQuery,
  importQuery,
  referenceQuery,
  type DefinitionKind,
} from './tag-queries.ts';

export const MIN_NAME_LENGTH = 3;
export const MAX_DEFINITIONS = 1000;
export const MAX_REFERENCES = 2000;
export const MAX_IMPORTS = 300;

export interface Definition {
  name: string;
  kind: DefinitionKind;
  startLine: number;
  endLine: number;
}

export interface FileSymbols {
  definitions: Definition[];
  references: string[];
  imports: string[];
}

interface LoadedLanguage {
  parser: Parser;
  definitions: Query;
  references: Query;
  imports: Query | null;
}

const require = createRequire(import.meta.url);
const loaded = new Map<SymbolLanguage, Promise<LoadedLanguage>>();
let initialised: Promise<void> | null = null;

function grammarPath(language: SymbolLanguage): string {
  return require.resolve(`@vscode/tree-sitter-wasm/wasm/tree-sitter-${language}.wasm`);
}

async function load(language: SymbolLanguage): Promise<LoadedLanguage> {
  initialised ??= Parser.init();
  await initialised;
  const grammar = await Language.load(grammarPath(language));
  const parser = new Parser();
  parser.setLanguage(grammar);
  const imports = importQuery(language);
  return {
    parser,
    definitions: new Query(grammar, definitionQuery(language)),
    references: new Query(grammar, referenceQuery(language)),
    imports: imports ? new Query(grammar, imports) : null,
  };
}

function languageFor(language: SymbolLanguage): Promise<LoadedLanguage> {
  let entry = loaded.get(language);
  if (!entry) {
    entry = load(language);
    loaded.set(language, entry);
  }
  return entry;
}

const MOCK_CALL = /^(?:vi|jest)\.(?:mock|doMock|unstable_mockModule|hoisted|fn|spyOn|mocked)\b/;

function isMockCall(node: Node | null): boolean {
  if (node?.type !== 'call_expression') return false;
  return MOCK_CALL.test(node.childForFieldName('function')?.text ?? '');
}

export function isMockDefinition(name: Node): boolean {
  for (let node = name.parent; node; node = node.parent) {
    if (isMockCall(node)) return true;
    if (node.type === 'variable_declarator' && isMockCall(node.childForFieldName('value'))) {
      return true;
    }
  }
  return false;
}

const NAME_WRAPPER = /_declarator$|^qualified_identifier$/;

export function declarationNode(name: Node): Node {
  let node = name.parent ?? name;
  while (node.parent && NAME_WRAPPER.test(node.type)) node = node.parent;
  return node;
}

function collectDefinitions(
  tools: LoadedLanguage,
  tree: Parameters<Query['captures']>[0],
  testFile: boolean,
) {
  const seen = new Map<string, Definition>();
  for (const capture of tools.definitions.captures(tree)) {
    const kind = definitionKind(capture.name);
    const name = capture.node.text;
    if (!kind || name.length < MIN_NAME_LENGTH || seen.has(name)) continue;
    if (isMockDefinition(capture.node) || (testFile && kind === 'variable')) continue;
    const declaration = declarationNode(capture.node);
    seen.set(name, {
      name,
      kind,
      startLine: declaration.startPosition.row + 1,
      endLine: declaration.endPosition.row + 1,
    });
    if (seen.size >= MAX_DEFINITIONS) break;
  }
  return [...seen.values()];
}

function collectReferences(
  tools: LoadedLanguage,
  tree: Parameters<Query['captures']>[0],
  defined: ReadonlySet<string>,
): string[] {
  const names = new Set<string>();
  for (const capture of tools.references.captures(tree)) {
    const name = capture.node.text;
    if (name.length < MIN_NAME_LENGTH || defined.has(name)) continue;
    names.add(name);
    if (names.size >= MAX_REFERENCES) break;
  }
  return [...names];
}

function pythonFromImport(from: string, name: string | undefined): string[] {
  if (name === undefined) return [from];
  const joined = from.endsWith('.') ? `${from}${name}` : `${from}.${name}`;
  return /^\.+$/.test(from) ? [joined] : [from, joined];
}

function importSpecs(captures: readonly { name: string; node: Node }[]): string[] {
  const byName = new Map(captures.map((capture) => [capture.name, capture.node.text]));
  const from = byName.get('from');
  if (from !== undefined) return pythonFromImport(from, byName.get('name'));
  const spec = byName.get('import');
  return spec === undefined ? [] : [spec.replace(/^"|"$/g, '')];
}

function collectImports(tools: LoadedLanguage, tree: Parameters<Query['matches']>[0]): string[] {
  if (!tools.imports) return [];
  const specs = new Set<string>();
  for (const match of tools.imports.matches(tree)) {
    for (const spec of importSpecs(match.captures)) {
      if (spec.length > 0) specs.add(spec);
    }
    if (specs.size >= MAX_IMPORTS) break;
  }
  return [...specs];
}

export async function extractSymbols(
  language: SymbolLanguage,
  source: string,
  testFile = false,
): Promise<FileSymbols> {
  const tools = await languageFor(language);
  const tree = tools.parser.parse(source);
  if (!tree) return { definitions: [], references: [], imports: [] };
  try {
    const definitions = collectDefinitions(tools, tree.rootNode, testFile);
    const defined = new Set(definitions.map((definition) => definition.name));
    return {
      definitions,
      references: collectReferences(tools, tree.rootNode, defined),
      imports: collectImports(tools, tree.rootNode),
    };
  } finally {
    tree.delete();
  }
}
