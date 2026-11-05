export interface SpecEndpoint {
  kind: 'route' | 'mount' | 'gql_field' | 'gql_op';
  method: string | null;
  path: string;
  offset: number;
}

const SPEC_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];
const SPEC_MARKER = /(?:^|[{,])\s*["']?(?:openapi|swagger)["']?\s*:/m;
const SPEC_EXTENSIONS = /\.(?:json|ya?ml)$/i;
const ROOT_TYPES = new Set(['Query', 'Mutation', 'Subscription']);

function specPath(path: string): string {
  return path.replace(/\{(\w+)\}/g, ':$1');
}

function jsonSpec(text: string): SpecEndpoint[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const spec = parsed as { paths?: Record<string, unknown>; basePath?: unknown };
  const endpoints: SpecEndpoint[] = [];
  if (typeof spec.basePath === 'string') {
    endpoints.push({ kind: 'mount', method: null, path: spec.basePath, offset: 0 });
  }
  for (const [path, operations] of Object.entries(spec.paths ?? {})) {
    const offset = Math.max(0, text.indexOf(JSON.stringify(path)));
    for (const method of Object.keys((operations ?? {}) as object)) {
      if (!SPEC_METHODS.includes(method)) continue;
      endpoints.push({ kind: 'route', method: method.toUpperCase(), path: specPath(path), offset });
    }
  }
  return endpoints;
}

function yamlSpec(text: string): SpecEndpoint[] {
  const endpoints: SpecEndpoint[] = [];
  const lines = text.split('\n');
  let offset = 0;
  let inPaths = false;
  let pathIndent = -1;
  let current: { path: string; offset: number } | null = null;
  for (const line of lines) {
    const lineOffset = offset;
    offset += line.length + 1;
    if (/^\S/.test(line)) {
      inPaths = /^paths\s*:\s*$/.test(line);
      const base = /^basePath\s*:\s*['"]?(\/[^'"\s]*)/.exec(line);
      if (base)
        endpoints.push({ kind: 'mount', method: null, path: base[1] ?? '', offset: lineOffset });
      current = null;
      continue;
    }
    if (!inPaths || line.trim() === '' || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const pathMatch = /^\s*['"]?(\/[^'":]*)['"]?\s*:\s*$/.exec(line);
    if (pathMatch && (pathIndent === -1 || indent === pathIndent)) {
      pathIndent = indent;
      current = { path: specPath(pathMatch[1] ?? ''), offset: lineOffset };
      continue;
    }
    const method = /^\s*(\w+)\s*:/.exec(line)?.[1] ?? '';
    if (current && indent > pathIndent && SPEC_METHODS.includes(method)) {
      endpoints.push({
        kind: 'route',
        method: method.toUpperCase(),
        path: current.path,
        offset: lineOffset,
      });
    }
  }
  return endpoints;
}

export function apiSpecEndpoints(path: string, text: string): SpecEndpoint[] {
  if (!SPEC_EXTENSIONS.test(path) || !SPEC_MARKER.test(text.slice(0, 4096))) return [];
  return path.toLowerCase().endsWith('.json') ? jsonSpec(text) : yamlSpec(text);
}

const SCHEMA_BLOCK = /\b(?:extend\s+)?type\s+(Query|Mutation|Subscription)\b[^{]*\{/g;
const OPERATION =
  /\b(query|mutation|subscription)\b\s*(?:\w+)?\s*(?:\([^)]*\))?\s*(?:@\w+\s*)*\{\s*(?:\w+\s*:\s*)?(\w+)/g;
const GRAPHQL_TAG = /\b(?:gql|graphql)\s*(?:\(\s*)?`/;
const GRAPHQL_EXTENSIONS = new Set(['graphql', 'gql', 'graphqls']);

function blockEnd(text: string, from: number): number {
  let depth = 1;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return index;
  }
  return text.length;
}

function schemaFields(text: string): SpecEndpoint[] {
  const endpoints: SpecEndpoint[] = [];
  for (const match of text.matchAll(SCHEMA_BLOCK)) {
    const type = match[1] ?? '';
    const start = match.index + match[0].length;
    const body = text
      .slice(start, blockEnd(text, start))
      .replace(/"""[\s\S]*?"""/g, '')
      .replace(/#[^\n]*/g, '')
      .replace(/\([^)]*\)/g, '');
    for (const field of body.matchAll(/(?:^|\n)\s*(\w+)\s*:/g)) {
      endpoints.push({
        kind: 'gql_field',
        method: null,
        path: `${type}.${field[1] ?? ''}`,
        offset: start,
      });
    }
  }
  return endpoints;
}

function operations(text: string): SpecEndpoint[] {
  const endpoints: SpecEndpoint[] = [];
  for (const match of text.matchAll(OPERATION)) {
    const keyword = match[1] ?? '';
    const type = `${keyword[0]?.toUpperCase() ?? ''}${keyword.slice(1)}`;
    if (!ROOT_TYPES.has(type)) continue;
    endpoints.push({
      kind: 'gql_op',
      method: null,
      path: `${type}.${match[2] ?? ''}`,
      offset: match.index,
    });
  }
  return endpoints;
}

export function graphqlEndpoints(extension: string, text: string): SpecEndpoint[] {
  const graphqlFile = GRAPHQL_EXTENSIONS.has(extension);
  if (!graphqlFile && !GRAPHQL_TAG.test(text) && !text.includes('type Query')) return [];
  return [...schemaFields(text), ...operations(text)];
}
