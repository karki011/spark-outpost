import { MAP_FILE_KINDS, type MapFileKind } from '@spark-outpost/contracts';
import { isServerModule, type Endpoint } from '../codescan/endpoints.ts';
import { isTestFile } from '../codescan/test-pairs.ts';

export interface KindInput {
  path: string;
  imports: readonly string[];
  endpoints: readonly Endpoint[];
}

const TEST =
  /(^|\/)(tests?|__tests__|e2e|fixtures?)\/|\.(test|spec)\.[a-z]+$|(stub|seed|fixture|mock)s?\.[a-z]+$/i;
const DATA =
  /(^|\/)(migrations?|persistence|schemas?|models?|contracts|db|prisma)\/|\.(sql|prisma|graphql|gql)$|(schema|migration|model)s?\.[a-z]+$/i;
const CONFIG =
  /(^|\/)(scripts|\.github|infra|config)\/|(^|\/)[^/]*(config|rc)\.[a-z]+$|\.(json|ya?ml|toml|ini|env|lock|sh)$|(^|\/)(Dockerfile|Makefile)$/i;
const API = /(^|\/)(api|routes?|handlers?|controllers?)\/|(^|[-_./])(api|routes?)\.[a-z]+$/i;
const UI =
  /\.(tsx|jsx|vue|svelte|css|scss|sass|less|html|astro)$|(^|\/)(components|pages|views|ui|web|app)\//i;
const SERVER_FOLDER = /(^|\/)(server|backend|services?|workers?|jobs|cmd|internal)\//i;
const BACKEND_CODE = /\.(py|go|rs|java|kt|cs|rb|php|scala|ex|exs)$/i;
const UI_LIBRARY =
  /^(react|react-dom(\/.*)?|vue|svelte(\/.*)?|@angular\/core|solid-js|preact|next\/(link|image|router|navigation))$/;
const DATA_LIBRARY =
  /^(pg|postgres|mysql2?|sqlite3|better-sqlite3|mongodb|mongoose|@prisma\/client|drizzle-orm(\/.*)?|typeorm|sequelize|knex|kysely|sqlalchemy(\..*)?|psycopg2?|django\.db(\..*)?|database\/sql|gorm\.io\/gorm|github\.com\/jmoiron\/sqlx)$/;

const imports = (file: KindInput, pattern: RegExp | ((spec: string) => boolean)) =>
  file.imports.some((spec) => (typeof pattern === 'function' ? pattern(spec) : pattern.test(spec)));

export function fileKind(file: KindInput): MapFileKind {
  const { path } = file;
  if (isTestFile(path) || TEST.test(path)) return 'test';
  if (file.endpoints.some((endpoint) => endpoint.kind === 'route' || endpoint.kind === 'mount')) {
    return 'api';
  }
  if (DATA.test(path)) return 'data';
  if (CONFIG.test(path)) return 'config';
  if (API.test(path)) return 'api';
  if (UI.test(path) || imports(file, UI_LIBRARY)) return 'ui';
  if (imports(file, DATA_LIBRARY)) return 'data';
  if (imports(file, isServerModule) || SERVER_FOLDER.test(path) || BACKEND_CODE.test(path)) {
    return 'api';
  }
  return 'other';
}

export function emptyKindCounts(): Record<MapFileKind, number> {
  return Object.fromEntries(MAP_FILE_KINDS.map((kind) => [kind, 0])) as Record<MapFileKind, number>;
}
