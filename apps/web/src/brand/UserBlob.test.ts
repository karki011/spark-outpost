import { describe, expect, it } from 'vitest';
import { userBlobExpression, userBlobSeed } from './UserBlob.tsx';

describe('userBlobSeed', () => {
  it('lowercases and trims the display name', () => {
    expect(userBlobSeed('  Ada Lovelace  ')).toBe('user:ada lovelace');
  });

  it('falls back to guest when the name is empty', () => {
    expect(userBlobSeed('')).toBe('user:guest');
    expect(userBlobSeed('   ')).toBe('user:guest');
  });
});

describe('userBlobExpression', () => {
  it('rests when nothing is going on', () => {
    expect(userBlobExpression(null)).toBe('idle');
  });

  it('follows what the chats are doing', () => {
    expect(userBlobExpression('working')).toBe('thinking');
    expect(userBlobExpression('alert')).toBe('unsure');
    expect(userBlobExpression('happy')).toBe('happy');
  });
});
