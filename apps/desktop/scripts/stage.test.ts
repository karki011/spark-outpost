import { describe, expect, it } from 'vitest';
import { pnpmCommand } from './stage.ts';

describe('pnpmCommand', () => {
  it('runs pnpm by name on the Mac', () => {
    expect(pnpmCommand(['deploy'], '/opt/pnpm/pnpm.cjs', 'darwin')).toEqual(['pnpm', ['deploy']]);
  });

  it('runs pnpm through node or its own exe on Windows, where pnpm.cmd cannot be spawned', () => {
    expect(pnpmCommand(['deploy'], 'C:\\pnpm\\pnpm.cjs', 'win32')).toEqual([
      process.execPath,
      ['C:\\pnpm\\pnpm.cjs', 'deploy'],
    ]);
    expect(pnpmCommand(['deploy'], 'C:\\setup-pnpm\\pnpm.exe', 'win32')).toEqual([
      'C:\\setup-pnpm\\pnpm.exe',
      ['deploy'],
    ]);
    expect(() => pnpmCommand(['deploy'], 'C:\\pnpm\\pnpm.cmd', 'win32')).toThrow(/through pnpm/);
    expect(() => pnpmCommand(['deploy'], undefined, 'win32')).toThrow(/through pnpm/);
  });
});
