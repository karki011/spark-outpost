import { describe, expect, it, vi } from 'vitest';
import { gatedSignature } from './scheduler.ts';

describe('checking a repository for changes', () => {
  it('skips the full signature while the git state is unchanged, until the recheck is due', async () => {
    let time = 0;
    let stamp: string | null = 's1';
    const full = vi.fn(async () => `sig-${full.mock.calls.length}`);
    const signature = gatedSignature(
      full,
      async () => stamp,
      () => time,
      1_000,
    );

    expect(await signature('/repo')).toBe('sig-1');
    time = 500;
    expect(await signature('/repo')).toBe('sig-1');
    expect(full).toHaveBeenCalledTimes(1);

    stamp = 's2';
    expect(await signature('/repo')).toBe('sig-2');

    time = 1_600;
    expect(await signature('/repo')).toBe('sig-3');
    expect(full).toHaveBeenCalledTimes(3);
  });

  it('always reads in full when the git state cannot be read', async () => {
    const full = vi.fn(async () => 'sig');
    const signature = gatedSignature(full, async () => null);
    await signature('/repo');
    await signature('/repo');
    expect(full).toHaveBeenCalledTimes(2);
  });

  it('keeps repositories apart', async () => {
    const full = vi.fn(async (root: string) => root);
    const signature = gatedSignature(full, async () => 'same');
    expect(await signature('/a')).toBe('/a');
    expect(await signature('/b')).toBe('/b');
  });
});
