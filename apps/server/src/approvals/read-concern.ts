import path from 'node:path';
import { resolveCommandPath } from './commands.ts';
import type { FileLister } from './file-lister.ts';
import { FILE_FUNCTIONS, changesFiles, loadsEnvFile, readsUnknownFiles } from './inline-code.ts';

export type ReadConcern = 'secret' | 'secret_read' | 'hidden' | 'unknown';
export type Concern = ReadConcern | null;

export interface ReadPlace {
  cwd: string;
  home: string;
  isSecret: (target: string) => boolean;
  readAsks: (target: string) => boolean;
  files: FileLister;
  inCode?: (targets: readonly string[]) => void;
}

const RANK: Record<ReadConcern, number> = { unknown: 1, hidden: 2, secret_read: 3, secret: 4 };
const UNKNOWN = /\$|`/;
const QUOTED = /(['"])([^'"\n]*)\1/g;
const PATH_SHAPED = /\/|^[.~]/;
const FILE_CALL = new RegExp(
  `\\b(?:${FILE_FUNCTIONS}|Path|PurePath|Pathname|join|load_dotenv|dotenv_values|remove|copy|move|(?:File|IO|FileUtils|Dir)\\.\\w+)\\s*\\((?:[^()]*?,)?\\s*$`,
);
const DICT_KEY = /^\s*:/;
const SUBSCRIPT_OPEN = /[\w)\]]\s*\[\s*$/;
const SUBSCRIPT_CLOSE = /^\s*\]/;

export function worst(concerns: Iterable<Concern>): Concern {
  let found: Concern = null;
  for (const concern of concerns) {
    if (concern && (!found || RANK[concern] > RANK[found])) found = concern;
  }
  return found;
}

function isKey(code: string, start: number, end: number): boolean {
  const after = code.slice(end, end + 8);
  if (DICT_KEY.test(after)) return true;
  return (
    SUBSCRIPT_CLOSE.test(after) && SUBSCRIPT_OPEN.test(code.slice(Math.max(0, start - 40), start))
  );
}

function namesFile(code: string, match: RegExpExecArray, changes: boolean): boolean {
  const literal = match[2]!;
  const start = match.index;
  const end = start + match[0].length;
  if (PATH_SHAPED.test(literal)) return true;
  if (isKey(code, start, end)) return false;
  return changes || FILE_CALL.test(code.slice(Math.max(0, start - 200), start));
}

function secretLiterals(code: string, place: ReadPlace, changes: boolean): string[] {
  return [...code.matchAll(QUOTED)].flatMap((match) => {
    const literal = match[2];
    if (!literal || UNKNOWN.test(literal)) return [];
    if (!namesFile(code, match, changes)) return [];
    const target = resolveCommandPath(literal, place.cwd, place.home);
    return place.isSecret(target) ? [target] : [];
  });
}

function envFile(code: string, place: ReadPlace): string[] {
  if (!loadsEnvFile(code)) return [];
  const target = path.join(place.cwd, '.env');
  return place.isSecret(target) ? [target] : [];
}

export function codeConcern(code: string, place: ReadPlace): Concern {
  const changes = changesFiles(code);
  const named = [...secretLiterals(code, place, changes), ...envFile(code, place)];
  if (named.length === 0) return readsUnknownFiles(code) ? 'unknown' : null;
  if (!changes && !named.some((target) => place.readAsks(target))) return 'secret_read';
  place.inCode?.(named);
  return 'secret';
}
