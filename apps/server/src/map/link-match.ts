import type { Endpoint } from '../codescan/endpoints.ts';

export type LinkKind = 'http' | 'graphql' | 'package' | 'env';

export interface LinkFile {
  path: string;
  areaId: string;
  importance: number;
  endpoints: readonly Endpoint[];
  imports: readonly string[];
}

export interface LinkRepo {
  id: string;
  files: readonly LinkFile[];
  packageNames: readonly string[];
}

export interface Link {
  kind: LinkKind;
  label: string;
  fromRepo: string;
  toRepo: string;
  fromPath: string;
  toPath: string;
  fromArea: string;
  toArea: string;
  fromLine: number | null;
  toLine: number | null;
  confidence: number;
  source: 'rules' | 'jev';
}

export interface RouteOption {
  label: string;
  file: LinkFile;
  line: number;
  score: number;
}

export interface AmbiguousCall {
  file: LinkFile;
  endpoint: Endpoint;
  options: RouteOption[];
}

const PARAM = /^(?::.*|\{.*\}|<.*>|\[.*\]|\*.*)$|\$\{/;
const GENERIC_ENV = new Set([
  'NODE_ENV',
  'PORT',
  'HOST',
  'HOSTNAME',
  'DEBUG',
  'CI',
  'HOME',
  'PATH',
  'TZ',
  'LOG_LEVEL',
  'ENV',
  'MODE',
  'DEV',
  'PROD',
  'BASE_URL',
  'SSR',
]);
const PUBLIC_ENV_PREFIX = /^(?:VITE_|NEXT_PUBLIC_|REACT_APP_|EXPO_PUBLIC_|PUBLIC_)/;

export function segments(path: string): string[] {
  return path
    .toLowerCase()
    .replace(/\$\{[^}]*\}/g, ':')
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => (PARAM.test(segment) || segment.includes(':') ? ':' : segment));
}

interface Fit {
  score: number;
  specificity: number;
}

function suffixFit(call: readonly string[], route: readonly string[]): Fit | null {
  if (route.length === 0 || call.length < route.length) return null;
  const offset = call.length - route.length;
  const fit: Fit = { score: 1, specificity: 0 };
  for (let index = 0; index < route.length; index += 1) {
    const left = call[offset + index] as string;
    const right = route[index] as string;
    if (right === ':') continue;
    if (left === ':') fit.score *= 0.6;
    else if (left === right) fit.specificity += 1;
    else return null;
  }
  return fit;
}

function prefixMatches(prefix: readonly string[], mounts: readonly string[][]): boolean {
  if (prefix.length === 0) return true;
  return mounts.some(
    (mount) =>
      mount.length === prefix.length && mount.every((segment, index) => segment === prefix[index]),
  );
}

export function httpFit(call: Endpoint, route: Endpoint, mounts: readonly string[][]): Fit | null {
  if (call.method && route.method && call.method !== route.method) return null;
  const callSegments = segments(call.path);
  const routeSegments = segments(route.path);
  if (!routeSegments.some((segment) => segment !== ':')) return null;
  const fit = suffixFit(callSegments, routeSegments);
  if (fit === null) return null;
  const prefix = callSegments.slice(0, callSegments.length - routeSegments.length);
  let base: number;
  if (prefix.length === 0) base = call.base ? 0.8 : 0.95;
  else if (prefixMatches(prefix, mounts)) base = 0.9;
  else if (call.base) base = 0.7;
  else return null;
  const methodKnown = call.method && route.method ? 1 : 0.9;
  return {
    score: Math.round(base * methodKnown * fit.score * 100) / 100,
    specificity: fit.specificity,
  };
}

function routeLabel(route: Endpoint, callPath: string): string {
  const callSegments = segments(callPath);
  const routeSegments = segments(route.path);
  const prefix = callSegments.slice(0, Math.max(0, callSegments.length - routeSegments.length));
  const shown = prefix.length > 0 ? `/${prefix.join('/')}${route.path}` : route.path;
  return `${route.method ?? 'ANY'} ${shown}`;
}

function endpointsOf(repo: LinkRepo, kind: Endpoint['kind']) {
  return repo.files.flatMap((file) =>
    file.endpoints
      .filter((endpoint) => endpoint.kind === kind)
      .map((endpoint) => ({ file, endpoint })),
  );
}

function link(
  kind: LinkKind,
  label: string,
  from: LinkRepo,
  to: LinkRepo,
  a: LinkFile,
  b: LinkFile,
) {
  return {
    kind,
    label,
    fromRepo: from.id,
    toRepo: to.id,
    fromPath: a.path,
    toPath: b.path,
    fromArea: a.areaId,
    toArea: b.areaId,
    fromLine: null,
    toLine: null,
    confidence: 0,
    source: 'rules' as const,
  };
}

export function matchHttp(callers: LinkRepo, targets: LinkRepo) {
  const routes = endpointsOf(targets, 'route');
  const mounts = endpointsOf(targets, 'mount').map(({ endpoint }) => segments(endpoint.path));
  const links: Link[] = [];
  const ambiguous: AmbiguousCall[] = [];
  for (const { file, endpoint } of endpointsOf(callers, 'call')) {
    const options = routes
      .flatMap((route) => {
        const fit = httpFit(endpoint, route.endpoint, mounts);
        return fit ? [{ route, ...fit }] : [];
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.specificity - a.specificity ||
          a.route.file.path.localeCompare(b.route.file.path),
      );
    const best = options[0];
    if (!best) continue;
    const tied = options.filter(
      (option) => option.score === best.score && option.specificity === best.specificity,
    );
    const distinct = new Set(
      tied.map((option) => routeLabel(option.route.endpoint, endpoint.path)),
    );
    const share = distinct.size > 1 ? 1 / distinct.size : 1;
    for (const option of tied) {
      links.push({
        ...link(
          'http',
          routeLabel(option.route.endpoint, endpoint.path),
          callers,
          targets,
          file,
          option.route.file,
        ),
        fromLine: endpoint.line,
        toLine: option.route.endpoint.line,
        confidence: Math.round(option.score * share * 100) / 100,
      });
    }
    if (distinct.size > 1) {
      ambiguous.push({
        file,
        endpoint,
        options: tied.map((option) => ({
          label: routeLabel(option.route.endpoint, endpoint.path),
          file: option.route.file,
          line: option.route.endpoint.line,
          score: option.score,
        })),
      });
    }
  }
  return { links, ambiguous };
}

export function matchGraphql(callers: LinkRepo, targets: LinkRepo): Link[] {
  const fields = new Map<string, { file: LinkFile; line: number }>();
  for (const { file, endpoint } of endpointsOf(targets, 'gql_field')) {
    if (!fields.has(endpoint.path)) fields.set(endpoint.path, { file, line: endpoint.line });
  }
  return endpointsOf(callers, 'gql_op').flatMap(({ file, endpoint }) => {
    const target = fields.get(endpoint.path);
    if (!target) return [];
    return [
      {
        ...link('graphql', endpoint.path, callers, targets, file, target.file),
        fromLine: endpoint.line,
        toLine: target.line,
        confidence: 0.9,
      },
    ];
  });
}

function packageName(spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('/')) return null;
  const parts = spec.split('/');
  return spec.startsWith('@')
    ? parts.length > 1
      ? `${parts[0]}/${parts[1]}`
      : null
    : (parts[0] ?? null);
}

function scopeOf(name: string): string | null {
  return name.startsWith('@') ? (name.split('/')[0] ?? null) : null;
}

function representative(files: readonly LinkFile[]): Map<string, LinkFile> {
  const byArea = new Map<string, LinkFile>();
  for (const file of files) {
    const current = byArea.get(file.areaId);
    if (!current || file.importance > current.importance) byArea.set(file.areaId, file);
  }
  return byArea;
}

function pairedLinks(
  kind: LinkKind,
  label: string,
  a: LinkRepo,
  b: LinkRepo,
  left: readonly LinkFile[],
  right: readonly LinkFile[],
  confidence: number,
): Link[] {
  const links: Link[] = [];
  for (const from of representative(left).values()) {
    for (const to of representative(right).values()) {
      links.push({ ...link(kind, label, a, b, from, to), confidence });
    }
  }
  return links;
}

export function matchPackages(a: LinkRepo, b: LinkRepo): Link[] {
  const owned = new Set([...a.packageNames, ...b.packageNames]);
  const scopes = new Set(
    [...owned].map(scopeOf).filter((scope): scope is string => scope !== null),
  );
  const importers = (repo: LinkRepo, name: string) =>
    repo.files.filter((file) => file.imports.some((spec) => packageName(spec) === name));
  const names = new Set(a.files.flatMap((file) => file.imports.map(packageName)));
  const links: Link[] = [];
  for (const name of [...names].filter((entry): entry is string => entry !== null).sort()) {
    const internal = owned.has(name);
    const sameScope = !internal && scopes.has(scopeOf(name) ?? '');
    if (!internal && !sameScope) continue;
    const right = importers(b, name);
    if (right.length === 0) continue;
    links.push(
      ...pairedLinks('package', name, a, b, importers(a, name), right, internal ? 0.85 : 0.6),
    );
  }
  return links;
}

function envName(key: string): string {
  return key.replace(PUBLIC_ENV_PREFIX, '');
}

export function matchEnv(a: LinkRepo, b: LinkRepo): Link[] {
  const users = (repo: LinkRepo) => {
    const byKey = new Map<string, LinkFile[]>();
    for (const { file, endpoint } of endpointsOf(repo, 'env')) {
      const key = envName(endpoint.path);
      if (GENERIC_ENV.has(key) || key.length < 4) continue;
      byKey.set(key, [...(byKey.get(key) ?? []), file]);
    }
    return byKey;
  };
  const left = users(a);
  const right = users(b);
  return [...left.keys()]
    .filter((key) => right.has(key))
    .sort()
    .flatMap((key) =>
      pairedLinks('env', key, a, b, left.get(key) ?? [], right.get(key) ?? [], 0.4),
    );
}
