import { describe, expect, it } from 'vitest';
import { parseLog, parseStatus } from './git.ts';
import { churnByFile, coChanged } from './history.ts';

describe('git output', () => {
  it('parses porcelain status including renames', () => {
    expect(parseStatus(' M src/a.ts\0R  src/new.ts\0src/old.ts\0?? notes.md\0')).toEqual([
      'src/a.ts',
      'src/new.ts',
      'notes.md',
    ]);
  });

  it('parses log records into commits and derives churn and co-change', () => {
    const commits = parseLog(
      '\u001e200\n\na.ts\nb.ts\n\u001e100\n\na.ts\nc.ts\n\u001e50\n\nd.ts\n',
    );
    expect(commits).toEqual([
      { at: 200, files: ['a.ts', 'b.ts'] },
      { at: 100, files: ['a.ts', 'c.ts'] },
      { at: 50, files: ['d.ts'] },
    ]);
    expect(churnByFile(commits).get('a.ts')).toBe(2);
    expect([...coChanged(commits, new Set(['a.ts']))]).toEqual([
      ['b.ts', 1],
      ['c.ts', 1],
    ]);
  });
});
