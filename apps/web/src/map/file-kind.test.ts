import { describe, expect, it } from 'vitest';
import { baseName, folderOf, shortName } from './file-kind.ts';

describe('file names', () => {
  it('splits names and folders', () => {
    expect(baseName('a/b/c.tsx')).toBe('c.tsx');
    expect(shortName('a/b/c.tsx')).toBe('c');
    expect(folderOf('a/b/c.tsx')).toBe('a/b/');
    expect(folderOf('c.tsx')).toBe('');
  });
});
