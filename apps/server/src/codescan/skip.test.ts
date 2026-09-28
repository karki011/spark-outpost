import { describe, expect, it } from 'vitest';
import { skipReason } from './skip.ts';

describe('skipReason', () => {
  it('skips dependencies, build output, lockfiles, generated and binary files', () => {
    expect(skipReason('node_modules/x/index.js')).toBe('directory');
    expect(skipReason('apps/web/dist/main.js')).toBe('directory');
    expect(skipReason('pnpm-lock.yaml')).toBe('lockfile');
    expect(skipReason('public/app.min.js')).toBe('generated');
    expect(skipReason('assets/logo.png')).toBe('binary');
    expect(skipReason('src/build-style.ts')).toBeNull();
  });
});
