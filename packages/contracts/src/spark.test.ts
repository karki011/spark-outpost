import { describe, expect, it } from 'vitest';
import { firstName } from './spark.ts';

describe('firstName', () => {
  it('uses the first word of the trimmed name', () => {
    expect(firstName('  Hari  Karki ')).toBe('Hari');
    expect(firstName('Sam')).toBe('Sam');
    expect(firstName('   ')).toBe('');
    expect(firstName('')).toBe('');
  });
});
