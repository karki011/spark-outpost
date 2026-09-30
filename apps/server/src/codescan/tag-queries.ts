import type { SymbolLanguage } from './languages.ts';

export const PARSER_VERSION = 'web-tree-sitter@0.27.0+tree-sitter-wasm@0.3.1+tags@2+imports@1';

export const DEFINITION_KINDS = [
  'function',
  'method',
  'class',
  'interface',
  'type',
  'enum',
  'variable',
  'module',
] as const;

export type DefinitionKind = (typeof DEFINITION_KINDS)[number];

const TYPESCRIPT_DEFINITIONS = `
(function_declaration name: (identifier) @def.function)
(generator_function_declaration name: (identifier) @def.function)
(class_declaration name: (type_identifier) @def.class)
(abstract_class_declaration name: (type_identifier) @def.class)
(interface_declaration name: (type_identifier) @def.interface)
(type_alias_declaration name: (type_identifier) @def.type)
(enum_declaration name: (identifier) @def.enum)
(method_definition name: (property_identifier) @def.method)
(program (lexical_declaration (variable_declarator name: (identifier) @def.variable)))
(export_statement (lexical_declaration (variable_declarator name: (identifier) @def.variable)))
(program (variable_declaration (variable_declarator name: (identifier) @def.variable)))
`;

const JAVASCRIPT_DEFINITIONS = `
(function_declaration name: (identifier) @def.function)
(generator_function_declaration name: (identifier) @def.function)
(class_declaration name: (identifier) @def.class)
(method_definition name: (property_identifier) @def.method)
(program (lexical_declaration (variable_declarator name: (identifier) @def.variable)))
(export_statement (lexical_declaration (variable_declarator name: (identifier) @def.variable)))
(program (variable_declaration (variable_declarator name: (identifier) @def.variable)))
`;

const DEFINITIONS: Record<SymbolLanguage, string> = {
  typescript: TYPESCRIPT_DEFINITIONS,
  tsx: TYPESCRIPT_DEFINITIONS,
  javascript: JAVASCRIPT_DEFINITIONS,
  python: `
(function_definition name: (identifier) @def.function)
(class_definition name: (identifier) @def.class)
(module (expression_statement (assignment left: (identifier) @def.variable)))
`,
  go: `
(function_declaration name: (identifier) @def.function)
(method_declaration name: (field_identifier) @def.method)
(type_spec name: (type_identifier) @def.type)
(const_spec name: (identifier) @def.variable)
(source_file (var_declaration (var_spec name: (identifier) @def.variable)))
`,
  rust: `
(function_item name: (identifier) @def.function)
(function_signature_item name: (identifier) @def.function)
(struct_item name: (type_identifier) @def.class)
(enum_item name: (type_identifier) @def.enum)
(trait_item name: (type_identifier) @def.interface)
(type_item name: (type_identifier) @def.type)
(const_item name: (identifier) @def.variable)
(static_item name: (identifier) @def.variable)
(mod_item name: (identifier) @def.module)
(macro_definition name: (identifier) @def.function)
`,
  java: `
(class_declaration name: (identifier) @def.class)
(record_declaration name: (identifier) @def.class)
(interface_declaration name: (identifier) @def.interface)
(enum_declaration name: (identifier) @def.enum)
(method_declaration name: (identifier) @def.method)
`,
  'c-sharp': `
(class_declaration name: (identifier) @def.class)
(struct_declaration name: (identifier) @def.class)
(record_declaration name: (identifier) @def.class)
(interface_declaration name: (identifier) @def.interface)
(enum_declaration name: (identifier) @def.enum)
(method_declaration name: (identifier) @def.method)
`,
  cpp: `
(function_declarator declarator: (identifier) @def.function)
(function_declarator declarator: (field_identifier) @def.method)
(function_declarator declarator: (qualified_identifier name: (identifier) @def.method))
(class_specifier name: (type_identifier) @def.class)
(struct_specifier name: (type_identifier) @def.class)
(enum_specifier name: (type_identifier) @def.enum)
(type_definition declarator: (type_identifier) @def.type)
`,
  ruby: `
(method name: (identifier) @def.method)
(singleton_method name: (identifier) @def.method)
(class name: (constant) @def.class)
(module name: (constant) @def.module)
`,
  php: `
(function_definition name: (name) @def.function)
(class_declaration name: (name) @def.class)
(interface_declaration name: (name) @def.interface)
(trait_declaration name: (name) @def.class)
(enum_declaration name: (name) @def.enum)
(method_declaration name: (name) @def.method)
`,
  bash: `
(function_definition name: (word) @def.function)
`,
};

const REFERENCE_NODES: Record<SymbolLanguage, readonly string[]> = {
  typescript: ['identifier', 'type_identifier', 'property_identifier'],
  tsx: ['identifier', 'type_identifier', 'property_identifier'],
  javascript: ['identifier', 'property_identifier'],
  python: ['identifier'],
  go: ['identifier', 'type_identifier', 'field_identifier', 'package_identifier'],
  rust: ['identifier', 'type_identifier', 'field_identifier'],
  java: ['identifier', 'type_identifier'],
  'c-sharp': ['identifier'],
  cpp: ['identifier', 'type_identifier', 'field_identifier', 'namespace_identifier'],
  ruby: ['identifier', 'constant'],
  php: ['name'],
  bash: ['command_name'],
};

const SCRIPT_IMPORTS = `
(import_statement source: (string (string_fragment) @import))
(export_statement source: (string (string_fragment) @import))
(call_expression function: (import) arguments: (arguments (string (string_fragment) @import)))
(call_expression function: (identifier) @_fn arguments: (arguments . (string (string_fragment) @import)) (#eq? @_fn "require"))
`;

const IMPORTS: Partial<Record<SymbolLanguage, string>> = {
  typescript: SCRIPT_IMPORTS,
  tsx: SCRIPT_IMPORTS,
  javascript: SCRIPT_IMPORTS,
  python: `
(import_statement name: (dotted_name) @import)
(import_statement name: (aliased_import name: (dotted_name) @import))
(import_from_statement module_name: (_) @from name: (dotted_name) @name)
(import_from_statement module_name: (_) @from name: (aliased_import name: (dotted_name) @name))
(import_from_statement module_name: (_) @from (wildcard_import))
`,
  go: `
(import_spec path: (interpreted_string_literal) @import)
`,
};

export function importQuery(language: SymbolLanguage): string | null {
  return IMPORTS[language] ?? null;
}

export function definitionQuery(language: SymbolLanguage): string {
  return DEFINITIONS[language];
}

export function referenceQuery(language: SymbolLanguage): string {
  return REFERENCE_NODES[language].map((type) => `(${type}) @ref`).join('\n');
}

export function definitionKind(capture: string): DefinitionKind | null {
  const kind = capture.startsWith('def.') ? capture.slice(4) : '';
  return (DEFINITION_KINDS as readonly string[]).includes(kind) ? (kind as DefinitionKind) : null;
}
