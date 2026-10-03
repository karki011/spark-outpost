import type { FileLister, FileSource } from './file-lister.ts';

const MAX_ROUNDS = 32;

type Fetch = () => Promise<void>;

function answering(
  answers: Map<string, unknown>,
  source: FileSource,
  misses: Map<string, Fetch>,
): FileLister {
  const lookup = <T>(key: string, fetch: () => Promise<T>): T | null => {
    if (answers.has(key)) return answers.get(key) as T;
    misses.set(key, async () => {
      answers.set(key, await fetch());
    });
    return null;
  };
  return {
    glob: (pattern, cwd) => lookup(`glob\0${cwd}\0${pattern}`, () => source.glob(pattern, cwd)),
    walk: (target) => lookup(`walk\0${target}`, () => source.walk(target)),
    script: (target) => lookup(`script\0${target}`, () => source.script(target)),
  };
}

export async function withPrefetchedFiles<T>(
  source: FileSource,
  decideWith: (files: FileLister) => T,
  undecided: T,
): Promise<T> {
  const answers = new Map<string, unknown>();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const misses = new Map<string, Fetch>();
    const result = decideWith(answering(answers, source, misses));
    if (misses.size === 0) return result;
    for (const fetch of misses.values()) await fetch();
  }
  return undecided;
}
