import { apiSpecEndpoints, graphqlEndpoints } from './api-specs.ts';
import { extensionOf } from './languages.ts';

export const ENDPOINT_KINDS = ['route', 'call', 'mount', 'gql_field', 'gql_op', 'env'] as const;
export type EndpointKind = (typeof ENDPOINT_KINDS)[number];

export interface Endpoint {
  kind: EndpointKind;
  method: string | null;
  path: string;
  line: number;
  base?: boolean;
}

export const MAX_ENDPOINTS = 200;
const MAX_PATH_LENGTH = 300;
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);

const SERVER_MODULES =
  /^(?:express|fastify|koa|@koa\/router|koa-router|hono|restify|@hapi\/hapi|@nestjs\/.+|fastapi|flask|django(?:\..+)?|starlette(?:\..+)?|net\/http|github\.com\/(?:gin-gonic\/gin|labstack\/echo.*|go-chi\/chi.*|gorilla\/mux|gofiber\/fiber.*))$/;
const CLIENT_RECEIVERS = new Set([
  'axios',
  'ky',
  '$http',
  'httpClient',
  'apiClient',
  'fetcher',
  'got',
  'superagent',
  'requests',
  'httpx',
  'session',
]);
const AMBIGUOUS_RECEIVERS = new Set(['api', 'client', 'http', 'request', 'instance', 'agent']);
const CALL_FUNCTION = /fetch|request|api|http|query|mutat|swr|get|post|put|patch|delete|send|call/i;

export interface LineIndex {
  at(offset: number): number;
}

export function lineIndex(text: string): LineIndex {
  const starts = [0];
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    starts.push(index + 1);
  }
  return {
    at(offset) {
      let low = 0;
      let high = starts.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if ((starts[middle] ?? 0) <= offset) low = middle;
        else high = middle - 1;
      }
      return low + 1;
    },
  };
}

export function isServerModule(spec: string): boolean {
  return SERVER_MODULES.test(spec);
}

function methodOf(word: string | undefined): string | null {
  const upper = (word ?? '').toUpperCase();
  return HTTP_METHODS.has(upper) ? upper : null;
}

function methodFromName(name: string): string | null {
  const lower = name.toLowerCase();
  for (const method of ['delete', 'patch', 'post', 'put']) {
    if (lower.includes(method)) return method.toUpperCase();
  }
  return /get|fetch|load|query|swr|use/.test(lower) ? 'GET' : null;
}

function stripHost(path: string): string {
  const match = /^https?:\/\/[^/]+(\/.*)?$/.exec(path);
  return match ? (match[1] ?? '/') : path;
}

function cleanPath(raw: string): { path: string; base: boolean } | null {
  let path = stripHost(raw.trim()).split('?')[0]?.split('#')[0] ?? '';
  let base = false;
  const leading = /^\$\{[^}]*\}/.exec(path);
  if (leading) {
    base = true;
    path = path.slice(leading[0].length);
  }
  if (!path.startsWith('/') || path.length > MAX_PATH_LENGTH || /\s/.test(path)) return null;
  return { path, base };
}

const RAW_KINDS = new Set<EndpointKind>(['env', 'gql_field', 'gql_op']);

class Collector {
  readonly endpoints: Endpoint[] = [];
  private readonly seen = new Set<string>();

  private readonly lines: LineIndex;

  constructor(lines: LineIndex) {
    this.lines = lines;
  }

  add(kind: EndpointKind, method: string | null, rawPath: string, offset: number): void {
    const cleaned = RAW_KINDS.has(kind) ? { path: rawPath, base: false } : cleanPath(rawPath);
    if (!cleaned || this.endpoints.length >= MAX_ENDPOINTS) return;
    const key = `${kind} ${method ?? '*'} ${cleaned.path} ${cleaned.base}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const endpoint: Endpoint = { kind, method, path: cleaned.path, line: this.lines.at(offset) };
    if (cleaned.base) endpoint.base = true;
    this.endpoints.push(endpoint);
  }
}

function joinPaths(prefix: string, path: string): string {
  const left = prefix.replace(/\/+$/, '');
  const right = path.replace(/^\/+/, '');
  const joined = `${left}/${right}`.replace(/\/+$/, '');
  return joined.startsWith('/') ? joined || '/' : `/${joined}`;
}

const MEMBER_CALL =
  /\b([A-Za-z_$][\w$]*)\s*\.\s*(get|post|put|patch|delete|options|head|all)\s*(?:<[^>()]*>)?\(\s*(['"`])((?:\/|https?:\/\/|\$\{)[^'"`]*)\3\s*(,\s*\{)?/g;
const FETCH_CALL = /\bfetch\s*\(\s*(['"`])((?:\/|https?:\/\/|\$\{)[^'"`]*)\1/g;
const CONCAT_CALL =
  /\b([A-Za-z_$][\w$]*)\s*\(\s*[\w$.]+\s*\+\s*(['"`])(\/[^'"`]*)\2(?:\s*\+\s*[\w$.]+)?/g;
const NAMED_CALL =
  /(?<![.\w$]\s*)\b([A-Za-z_$][\w$]*)\s*(?:<[^>()]*>)?\(\s*(['"`])(\/[^'"`\s]*)\2/g;
const EXPRESS_USE =
  /\b([A-Za-z_$][\w$]*)\s*\.\s*(use|route|register)\s*\(\s*(['"`])(\/[^'"`]*)\3\s*(,)?/g;
const PREFIX_OPTION = /\bprefix\s*:\s*(['"`])(\/[^'"`]*)\1/g;
const FETCH_METHOD = /method\s*:\s*['"`](\w+)['"`]/;
const NEST_CONTROLLER = /@Controller\(\s*(?:['"`]([^'"`]*)['"`])?/;
const NEST_ROUTE = /@(Get|Post|Put|Patch|Delete|All)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g;

function fetchMethod(text: string, from: number): string | null {
  const window = text.slice(from, from + 300);
  const end = window.search(/\bfetch\s*\(/);
  return methodOf(FETCH_METHOD.exec(end >= 0 ? window.slice(0, end) : window)?.[1]);
}

function scriptMemberCalls(text: string, server: boolean, out: Collector): void {
  for (const match of text.matchAll(MEMBER_CALL)) {
    const receiver = match[1] ?? '';
    const verb = (match[2] ?? '').toUpperCase();
    const path = match[4] ?? '';
    const client =
      CLIENT_RECEIVERS.has(receiver) ||
      (!server && (AMBIGUOUS_RECEIVERS.has(receiver) || match[5] !== undefined));
    const method = verb === 'ALL' ? null : verb;
    if (client) out.add('call', method, path, match.index);
    else if (server && !path.startsWith('http')) out.add('route', method, path, match.index);
  }
}

function scriptServerExtras(text: string, out: Collector): void {
  for (const match of text.matchAll(EXPRESS_USE)) {
    const verb = match[2];
    const kind = verb === 'route' && match[5] === undefined ? 'route' : 'mount';
    out.add(kind, null, match[4] ?? '', match.index);
  }
  for (const match of text.matchAll(PREFIX_OPTION))
    out.add('mount', null, match[2] ?? '', match.index);
  const controller = NEST_CONTROLLER.exec(text);
  if (!controller) return;
  const prefix = controller[1] ?? '';
  for (const match of text.matchAll(NEST_ROUTE)) {
    const method = match[1] === 'All' ? null : (match[1] ?? '').toUpperCase();
    out.add('route', method, joinPaths(`/${prefix}`, match[2] ?? ''), match.index);
  }
}

function scriptClientCalls(text: string, out: Collector): void {
  for (const match of text.matchAll(FETCH_CALL)) {
    const method = fetchMethod(text, match.index + match[0].length);
    out.add('call', method ?? 'GET', match[2] ?? '', match.index);
  }
  for (const match of text.matchAll(CONCAT_CALL)) {
    const name = match[1] ?? '';
    if (!CALL_FUNCTION.test(name)) continue;
    out.add('call', methodFromName(name), `\${base}${match[3] ?? ''}`, match.index);
  }
  for (const match of text.matchAll(NAMED_CALL)) {
    const name = match[1] ?? '';
    if (name === 'fetch' || !CALL_FUNCTION.test(name)) continue;
    out.add('call', methodFromName(name), match[3] ?? '', match.index);
  }
}

const NEXT_PAGES_API = /(?:^|\/)pages\/(api\/.+)\.(?:[jt]sx?|mjs)$/;
const NEXT_APP_ROUTE = /(?:^|\/)app\/((?:.+\/)?)route\.(?:[jt]s|mjs)$/;
const NEXT_HANDLER = /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g;

function nextSegments(path: string): string {
  const segments = path
    .split('/')
    .filter((segment) => segment && !/^\(.*\)$/.test(segment) && segment !== 'index')
    .map((segment) =>
      segment.replace(/^\[\[?\.{3}(.+?)\]?\]$/, ':$1*').replace(/^\[(.+)\]$/, ':$1'),
    );
  return `/${segments.join('/')}`;
}

function nextRoutes(path: string, text: string, out: Collector): void {
  const pages = NEXT_PAGES_API.exec(path);
  if (pages) out.add('route', null, nextSegments(pages[1] ?? ''), 0);
  const app = NEXT_APP_ROUTE.exec(path);
  if (!app) return;
  for (const match of text.matchAll(NEXT_HANDLER)) {
    out.add('route', match[1] ?? null, nextSegments(app[1] ?? ''), match.index);
  }
}

const PY_DECORATOR =
  /@\s*([\w.]+)\.(get|post|put|patch|delete|route|api_route|websocket)\(\s*[rf]?(['"])([^'"]*)\3([^)]*)\)/g;
const PY_PREFIX = /(?:APIRouter|Blueprint)\([^)]*?(?:url_)?prefix\s*=\s*[rf]?['"]([^'"]+)['"]/;
const PY_MOUNT =
  /(?:include_router|register_blueprint)\([^)]*?(?:url_)?prefix\s*=\s*[rf]?['"]([^'"]+)['"]/g;
const PY_METHODS = /methods\s*=\s*[[(]([^\])]*)[\])]/;
const DJANGO_PATH = /\b(?:re_)?path\(\s*r?['"]\^?([^'"$]*)\$?['"]\s*,\s*(include\()?/g;
const PY_CLIENT =
  /\b(requests|httpx|session|client)\.(get|post|put|patch|delete)\(\s*f?(['"])([^'"]+)\3/g;

function pythonRoutes(path: string, text: string, out: Collector): void {
  const prefix = PY_PREFIX.exec(text)?.[1] ?? '';
  for (const match of text.matchAll(PY_DECORATOR)) {
    const verb = match[2] ?? '';
    const routePath = joinPaths(prefix, match[4] ?? '');
    if (verb !== 'route' && verb !== 'api_route') {
      out.add('route', verb === 'websocket' ? null : verb.toUpperCase(), routePath, match.index);
      continue;
    }
    const methods = PY_METHODS.exec(match[5] ?? '')?.[1]?.match(/\w+/g) ?? ['GET'];
    for (const method of methods) out.add('route', methodOf(method), routePath, match.index);
  }
  for (const match of text.matchAll(PY_MOUNT)) out.add('mount', null, match[1] ?? '', match.index);
  if (/(?:^|\/)urls\.py$/.test(path)) {
    for (const match of text.matchAll(DJANGO_PATH)) {
      const routePath = `/${(match[1] ?? '').replace(/<(?:\w+:)?(\w+)>/g, ':$1')}`;
      out.add(match[2] ? 'mount' : 'route', null, routePath, match.index);
    }
  }
  for (const match of text.matchAll(PY_CLIENT)) {
    const raw = (match[4] ?? '').replace(/\{([^}]*)\}/g, '${$1}');
    out.add('call', (match[2] ?? '').toUpperCase(), raw, match.index);
  }
}

const GO_ROUTE =
  /\b(\w+)\s*\.\s*(GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete|HandleFunc|Handle|Any)\(\s*"([^"]*)"/g;
const GO_MOUNT = /\.\s*(?:Group|PathPrefix|Route|Mount)\(\s*"(\/[^"]*)"/g;

function goRoutes(text: string, out: Collector): void {
  for (const match of text.matchAll(GO_ROUTE)) {
    const receiver = match[1] ?? '';
    const verb = match[2] ?? '';
    const pattern = match[3] ?? '';
    if (receiver === 'http' && (verb === 'Get' || verb === 'Post')) {
      out.add('call', verb.toUpperCase(), pattern, match.index);
      continue;
    }
    if (verb === 'HandleFunc' || verb === 'Handle') {
      const [first, second] = pattern.split(/\s+/, 2);
      const method = second ? methodOf(first) : null;
      out.add(
        'route',
        method,
        (second ?? first ?? '').replace(/\{(\w+)\.{0,3}\}/g, ':$1'),
        match.index,
      );
      continue;
    }
    out.add('route', methodOf(verb === 'Any' ? '' : verb), pattern, match.index);
  }
  for (const match of text.matchAll(GO_MOUNT)) out.add('mount', null, match[1] ?? '', match.index);
}

const SPRING_CLASS =
  /@RequestMapping\(\s*(?:value\s*=\s*|path\s*=\s*)?"([^"]*)"[^)]*\)\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:public\s+)?(?:final\s+)?class\b/;
const SPRING_ROUTE =
  /@(Get|Post|Put|Patch|Delete|Request)Mapping(?:\(\s*(?:value\s*=\s*|path\s*=\s*)?"([^"]*)")?/g;

function springRoutes(text: string, out: Collector): void {
  const classMatch = SPRING_CLASS.exec(text);
  const prefix = classMatch?.[1] ?? '';
  for (const match of text.matchAll(SPRING_ROUTE)) {
    if (classMatch && match.index === classMatch.index) continue;
    const method = match[1] === 'Request' ? null : (match[1] ?? '').toUpperCase();
    out.add('route', method, joinPaths(prefix || '/', match[2] ?? ''), match.index);
  }
}

const ENV_PATTERNS = [
  /\bprocess\.env\.([A-Z_][A-Z0-9_]*)/g,
  /\bprocess\.env\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\]/g,
  /\bimport\.meta\.env\.([A-Z_][A-Z0-9_]*)/g,
  /\bos\.environ(?:\.get)?[[(]\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
  /\bos\.getenv\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
  /\bos\.Getenv\(\s*"([A-Z_][A-Z0-9_]*)"/g,
];

function envKeys(text: string, out: Collector): void {
  for (const pattern of ENV_PATTERNS) {
    for (const match of text.matchAll(pattern)) out.add('env', null, match[1] ?? '', match.index);
  }
}

const SCRIPT_LANGUAGES = new Set(['typescript', 'tsx', 'javascript']);

export function extractEndpoints(
  path: string,
  text: string,
  language: string | null,
  imports: readonly string[],
): Endpoint[] {
  const out = new Collector(lineIndex(text));
  const server = imports.some(isServerModule);
  if (language && SCRIPT_LANGUAGES.has(language)) {
    scriptMemberCalls(text, server, out);
    if (server) scriptServerExtras(text, out);
    else scriptClientCalls(text, out);
    nextRoutes(path, text, out);
  }
  if (language === 'python') pythonRoutes(path, text, out);
  if (language === 'go') goRoutes(text, out);
  if (language === 'java' && text.includes('Mapping')) springRoutes(text, out);
  if (language) envKeys(text, out);
  for (const endpoint of graphqlEndpoints(extensionOf(path), text)) {
    out.add(endpoint.kind, null, endpoint.path, endpoint.offset);
  }
  for (const endpoint of apiSpecEndpoints(path, text)) {
    out.add(endpoint.kind, endpoint.method, endpoint.path, endpoint.offset);
  }
  return out.endpoints;
}
