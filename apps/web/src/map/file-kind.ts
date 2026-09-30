export const FILE_KINDS = ['ui', 'api', 'data', 'test', 'config'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const FILE_KIND_LABELS: Record<FileKind, string> = {
  ui: 'UI',
  api: 'API',
  data: 'Data',
  test: 'Tests',
  config: 'Config',
};

const TEST =
  /(^|\/)(tests?|__tests__|e2e|fixtures?)\/|\.(test|spec)\.[a-z]+$|(stub|seed|fixture|mock)s?\.[a-z]+$/i;
const DATA =
  /(^|\/)(migrations?|persistence|schemas?|models?|contracts|db|prisma)\/|\.(sql|prisma|graphql|gql)$|(schema|migration|model)s?\.[a-z]+$/i;
const CONFIG =
  /(^|\/)(scripts|\.github|infra|config)\/|(^|\/)[^/]*(config|rc)\.[a-z]+$|\.(json|ya?ml|toml|ini|env|lock|sh)$|(^|\/)(Dockerfile|Makefile)$/i;
const API = /(^|\/)(api|routes?|handlers?|controllers?)\/|(^|[-_./])(api|routes?)\.[a-z]+$/i;
const UI =
  /\.(tsx|jsx|vue|svelte|css|scss|less|html|astro)$|(^|\/)(components|pages|views|ui|web|app)\//i;

export function fileKind(path: string): FileKind {
  if (TEST.test(path)) return 'test';
  if (DATA.test(path)) return 'data';
  if (CONFIG.test(path)) return 'config';
  if (API.test(path)) return 'api';
  if (UI.test(path)) return 'ui';
  return 'api';
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function shortName(path: string): string {
  return baseName(path).replace(/\.(tsx?|jsx?|mjs|cjs|css|py|go|rs|rb|java|kt)$/, '');
}

export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash + 1);
}
