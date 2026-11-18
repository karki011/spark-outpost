import { describe, expect, it } from 'vitest';
import { codeChangeProblem, isFullCode, normalizeCode, retrySeconds } from './lock-code.ts';

describe('normalizeCode', () => {
  it('keeps digits only, so a pasted code with spaces or dashes works', () => {
    expect(normalizeCode('12 34-56')).toBe('123456');
    expect(normalizeCode('a1b2c3')).toBe('123');
    expect(normalizeCode('')).toBe('');
  });

  it('stops at six digits', () => {
    expect(normalizeCode('1234567890')).toBe('123456');
  });

  it('drops digits from other scripts', () => {
    expect(normalizeCode('١٢٣456')).toBe('456');
  });
});

describe('isFullCode', () => {
  it('is true only at six digits', () => {
    expect(isFullCode('12345')).toBe(false);
    expect(isFullCode('123456')).toBe(true);
  });
});

describe('retrySeconds', () => {
  it('is zero with no wait or a wait that has passed', () => {
    expect(retrySeconds(null, 1_000)).toBe(0);
    expect(retrySeconds(1_000, 1_000)).toBe(0);
    expect(retrySeconds(1_000, 5_000)).toBe(0);
  });

  it('rounds the remaining time up to whole seconds', () => {
    expect(retrySeconds(61_000, 1_000)).toBe(60);
    expect(retrySeconds(61_000, 60_001)).toBe(1);
    expect(retrySeconds(61_000, 59_999)).toBe(2);
  });
});

describe('codeChangeProblem', () => {
  it('asks for all six digits before comparing', () => {
    expect(codeChangeProblem('123', '123')).toBe('Enter all 6 digits.');
  });

  it('reports codes that differ and accepts ones that match', () => {
    expect(codeChangeProblem('123456', '123457')).toBe('The codes don’t match.');
    expect(codeChangeProblem('123456', '123456')).toBeNull();
  });
});
