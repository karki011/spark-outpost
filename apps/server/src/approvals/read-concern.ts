import { resolveCommandPath } from './commands.ts';
import type { FileLister } from './file-lister.ts';
import { loadsEnvFile, readsUnknownFiles } from './inline-code.ts';

export type ReadConcern = 'secret' | 'hidden' | 'unknown';
export type Concern = ReadConcern | null;

export interface ReadPlace {
  cwd: string;
  home: string;
  isSecret: (target: string) => boolean;
  files: FileLister;
}

const RANK: Record<ReadConcern, number> = { unknown: 1, hidden: 2, secret: 3 };
const UNKNOWN = /\$|`/;
const QUOTED = /(['"])([^'"\n]*)\1/g;

export function worst(concerns: Iterable<Concern>): Concern {
  let found: Concern = null;
  for (const concern of concerns) {
    if (concern && (!found || RANK[concern] > RANK[found])) found = concern;
  }
  return found;
}

function namesSecretLiteral(code: string, place: ReadPlace): boolean {
  return [...code.matchAll(QUOTED)].some(([, , literal]) => {
    if (!literal || UNKNOWN.test(literal)) return false;
    return place.isSecret(resolveCommandPath(literal, place.cwd, place.home));
  });
}

export function codeConcern(code: string, place: ReadPlace): Concern {
  if (namesSecretLiteral(code, place) || loadsEnvFile(code)) return 'secret';
  return readsUnknownFiles(code) ? 'unknown' : null;
}
