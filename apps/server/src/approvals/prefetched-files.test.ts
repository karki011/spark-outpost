import { describe, expect, it } from 'vitest';
import type { FileLister, FileSource } from './file-lister.ts';
import { withPrefetchedFiles } from './prefetched-files.ts';

function countingSource(): FileSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    glob: async (pattern) => {
      calls.push(`glob ${pattern}`);
      return pattern === '*' ? ['/w/src'] : [];
    },
    walk: async (target) => {
      calls.push(`walk ${target}`);
      return [`${target}/.env`];
    },
    script: async (target) => {
      calls.push(`script ${target}`);
      return { text: 'echo hi', committed: false };
    },
  };
}

function secretBelowGlob(files: FileLister): string {
  const targets = files.glob('*', '/w');
  if (targets === null) return 'unknown';
  const walked = targets.flatMap((target) => files.walk(target) ?? []);
  const script = files.script('/w/run.sh');
  return `${walked.join(',')} ${script?.text ?? 'none'}`;
}

describe('withPrefetchedFiles', () => {
  it('answers a synchronous decision from files read ahead, each once', async () => {
    const source = countingSource();
    const result = await withPrefetchedFiles(source, secretBelowGlob, 'undecided');
    expect(result).toBe('/w/src/.env echo hi');
    expect(source.calls).toEqual(['glob *', 'walk /w/src', 'script /w/run.sh']);
  });

  it('returns the fallback when the decision keeps asking for new files', async () => {
    let next = 0;
    const endless = (files: FileLister) => files.walk(`/w/${next++}`)?.join(',') ?? 'waiting';
    expect(await withPrefetchedFiles(countingSource(), endless, 'undecided')).toBe('undecided');
  });
});
