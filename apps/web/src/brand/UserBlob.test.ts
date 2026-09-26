import { describe, expect, it } from 'vitest';
import { userBlobSeed } from './UserBlob.tsx';

describe('userBlobSeed', () => {
  it('lowercases and trims the display name', () => {
    expect(userBlobSeed('  Ada Lovelace  ')).toBe('user:ada lovelace');
  });

  it('falls back to guest when the name is empty', () => {
    expect(userBlobSeed('')).toBe('user:guest');
    expect(userBlobSeed('   ')).toBe('user:guest');
  });
});
