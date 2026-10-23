import { describe, expect, it } from 'vitest';
import { toolPath } from './tool-titles.ts';

describe('toolPath', () => {
  it('takes the first location, whole', () => {
    expect(toolPath([{ path: '/repo/My File, v2.ts' }, { path: '/repo/b.ts' }], null)).toBe(
      '/repo/My File, v2.ts',
    );
  });

  it("falls back to the tool input's file path", () => {
    expect(toolPath([], { file_path: '/repo/a.ts', limit: 4 })).toBe('/repo/a.ts');
    expect(toolPath(null, { notebook_path: '/repo/n.ipynb' })).toBe('/repo/n.ipynb');
    expect(toolPath(undefined, { path: 'src/x.ts' })).toBe('src/x.ts');
  });

  it('gives nothing without a path', () => {
    expect(toolPath([], { command: 'ls' })).toBeNull();
    expect(toolPath(null, 'a.ts')).toBeNull();
    expect(toolPath(null, { file_path: '  ' })).toBeNull();
  });
});
