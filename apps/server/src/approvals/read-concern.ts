import path from 'node:path';
import { resolveCommandPath } from './commands.ts';
import type { FileLister } from './file-lister.ts';
import { changesFiles, loadsEnvFile, readsUnknownFiles } from './inline-code.ts';

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
const FILE_CALL =
  /\b(?:open|fopen|Path|PurePath|join|readFileSync|readFile|writeFileSync|writeFile|appendFileSync|appendFile|createReadStream|createWriteStream|file_get_contents|file_put_contents|load_dotenv|dotenv_values|unlinkSync|unlink|remove|renameSync|rename|copyFileSync|copyFile|copyfile|copy2|copy|move|readTextFile|writeTextFile)\s*\((?:[^()]*?,)?\s*$/;
const DICT_KEY = /^\s*:/;

export function worst(concerns: Iterable<Concern>): Concern {
  let found: Concern = null;
  for (const concern of concerns) {
    if (concern && (!found || RANK[concern] > RANK[found])) found = concern;
  }
  return found;
}

function namesFile(code: string, literal: string, start: number, end: number): boolean {
  if (PATH_SHAPED.test(literal)) return true;
  if (DICT_KEY.test(code.slice(end, end + 8))) return false;
  return FILE_CALL.test(code.slice(Math.max(0, start - 200), start));
}

function secretLiterals(code: string, place: ReadPlace): string[] {
  return [...code.matchAll(QUOTED)].flatMap((match) => {
    const literal = match[2];
    if (!literal || UNKNOWN.test(literal)) return [];
    const end = match.index + match[0].length;
    if (!namesFile(code, literal, match.index, end)) return [];
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
  const named = [...secretLiterals(code, place), ...envFile(code, place)];
  if (named.length === 0) return readsUnknownFiles(code) ? 'unknown' : null;
  if (!named.some((target) => place.readAsks(target)) && !changesFiles(code)) return 'secret_read';
  place.inCode?.(named);
  return 'secret';
}
