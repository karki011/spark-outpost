import { describe, expect, it } from 'vitest';
import { declaredManager, packageManager } from './detect.ts';

describe('the package manager of a project', () => {
  it('comes from package.json first, then the lockfile, then npm', () => {
    expect(packageManager(new Set(['yarn.lock']))).toBe('yarn');
    expect(packageManager(new Set(['yarn.lock']), '{"packageManager":"pnpm@9.0.0"}')).toBe('pnpm');
    expect(packageManager(new Set())).toBe('npm');
  });

  it('ignores a broken package.json and a manager it does not know', () => {
    expect(declaredManager('{')).toBeNull();
    expect(declaredManager('{"packageManager":"deno@2"}')).toBeNull();
  });
});
