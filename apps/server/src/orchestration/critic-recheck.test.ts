import { describe, expect, it } from 'vitest';
import { recheckFollowUp, riskiestFiles, type RecheckFacts } from './critic-recheck.ts';

const file = (path: string, additions: number, deletions = 0) => ({ path, additions, deletions });

const D2: RecheckFacts = {
  toolCalls: 0,
  files: [
    file('migrations/002_upload_tags.sql', 8),
    file('src/slug.ts', 9),
    file('test/slug.test.ts', 20),
  ],
  stakesFiles: new Set(['migrations/002_upload_tags.sql']),
  destructive: false,
};

describe('riskiestFiles', () => {
  it('names the high-stakes file first, then the biggest source changes', () => {
    expect(riskiestFiles(D2)).toEqual(['migrations/002_upload_tags.sql', 'src/slug.ts']);
    const plain = { ...D2, stakesFiles: new Set<string>() };
    expect(riskiestFiles(plain)).toEqual(['src/slug.ts', 'migrations/002_upload_tags.sql']);
  });

  it('caps the list at three files', () => {
    const many = {
      ...D2,
      stakesFiles: new Set<string>(),
      files: ['a', 'b', 'c', 'd'].map((name, index) => file(`src/${name}.ts`, index + 1)),
    };
    expect(riskiestFiles(many)).toEqual(['src/d.ts', 'src/c.ts', 'src/b.ts']);
  });

  it('leaves a Critic alone once it opened files', () => {
    expect(riskiestFiles({ ...D2, toolCalls: 2 })).toBeNull();
  });

  it('leaves a small, low-stakes diff alone', () => {
    const small = {
      ...D2,
      files: [file('src/slug.ts', 9), file('test/slug.test.ts', 20), file('README.md', 2)],
      stakesFiles: new Set<string>(),
    };
    expect(riskiestFiles(small)).toBeNull();
    expect(riskiestFiles({ ...small, destructive: true })).toEqual(['src/slug.ts']);
    expect(riskiestFiles({ ...small, stakesFiles: new Set(['README.md']) })).toEqual([
      'src/slug.ts',
    ]);
  });
});

describe('recheckFollowUp', () => {
  it('names the files to open and asks for the full reply again', () => {
    const text = recheckFollowUp(['migrations/002_upload_tags.sql', 'src/slug.ts']);
    expect(text).toContain('Open `migrations/002_upload_tags.sql`, `src/slug.ts` now');
    expect(text).toContain('end with the Verdict line');
  });
});
