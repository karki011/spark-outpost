import { describe, expect, it } from 'vitest';
import { awaitRanking, likelyFilesLine } from './likely-files.ts';
import type { Ranking } from './observe-rank.ts';

const ranking: Ranking = {
  files: [],
  predicted: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
  probabilities: new Map([
    ['src/a.ts', 0.82],
    ['src/b.ts', 0.4],
  ]),
};

describe('likelyFilesLine', () => {
  it('lists the ranked files Jev gave a probability, as a hint', () => {
    expect(likelyFilesLine(ranking)).toBe(
      'Likely files (a ranking hint, not a limit): src/a.ts (0.82), src/b.ts (0.40)',
    );
  });

  it('keeps only the files relevant to a piece', () => {
    expect(likelyFilesLine(ranking, (path) => path === 'src/b.ts')).toBe(
      'Likely files (a ranking hint, not a limit): src/b.ts (0.40)',
    );
    expect(likelyFilesLine(ranking, () => false)).toBeNull();
  });

  it('gives no hint without a Jev ranking', () => {
    expect(likelyFilesLine(null)).toBeNull();
    expect(likelyFilesLine({ ...ranking, probabilities: new Map() })).toBeNull();
  });
});

describe('awaitRanking', () => {
  it('stops waiting for a slow ranking', async () => {
    const never = new Promise<Ranking | null>(() => undefined);
    expect(await awaitRanking({ ranking: never }, 5)).toBeNull();
    expect(await awaitRanking({ ranking: Promise.resolve(ranking) }, 5)).toBe(ranking);
    expect(await awaitRanking({})).toBeNull();
  });
});
