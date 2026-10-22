import { describe, expect, it } from 'vitest';
import { compileArgs, nodeApiHeaders, noActivateBuiltDir } from './no-activate-bundle.ts';

describe('no-activate addon build', () => {
  it('builds a loadable bundle for the chosen CPU and the app’s oldest macOS', () => {
    const args = compileArgs('/r/no_activate.mm', '/node/include/node', 'x64', '/out.node');
    expect(args.slice(0, 3)).toEqual(['-bundle', '-undefined', 'dynamic_lookup']);
    expect(args).toContain('x86_64');
    expect(args).toContain('-mmacosx-version-min=12.0');
    expect(args.slice(-3)).toEqual(['/r/no_activate.mm', '-o', '/out.node']);
  });

  it('reads Node-API headers beside the running Node and builds into .local', () => {
    expect(nodeApiHeaders('/opt/node/bin/node')).toBe('/opt/node/include/node');
    expect(noActivateBuiltDir('/r', 'arm64')).toBe('/r/.local/no-activate/arm64');
  });
});
