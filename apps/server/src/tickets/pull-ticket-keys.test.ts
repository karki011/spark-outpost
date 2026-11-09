import { describe, expect, it } from 'vitest';
import { keysIn } from './pull-ticket-keys.ts';

describe('keysIn', () => {
  it('finds keys in a branch and a title, once each', () => {
    expect(keysIn('spark/web-418-fix-uploads', 'WEB-418: Fix uploads (API-95)')).toEqual([
      'WEB-418',
      'API-95',
    ]);
  });

  it('needs a whole key with nothing stuck to either side', () => {
    expect(keysIn('WEB-4189a', 'WEB-')).toEqual([]);
    expect(keysIn('Tidy the notes', null)).toEqual([]);
  });

  it('reads at most five keys', () => {
    expect(keysIn('A-1 B-2 C-3 D-4 E-5 F-6')).toHaveLength(5);
  });
});
