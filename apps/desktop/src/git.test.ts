import { describe, expect, it } from 'vitest';
import { detectGit } from './git.ts';

describe('detectGit', () => {
  it('reports the installed version', async () => {
    const version = await detectGit(async () => ({ stdout: 'git version 2.50.1\n' }));
    expect(version).toBe('git version 2.50.1');
  });

  it('reports missing git when the command fails, as the macOS shim does', async () => {
    const version = await detectGit(async () => {
      throw new Error('xcrun: error: invalid active developer path');
    });
    expect(version).toBeNull();
  });
});
