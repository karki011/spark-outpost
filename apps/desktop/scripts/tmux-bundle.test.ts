import { describe, expect, it } from 'vitest';
import { binaryProblems, clangArch, foreignLibraries, minimumOs } from './bundled-binary.ts';
import { hostTriple, LIBEVENT, TMUX, tmuxBuiltDir, tmuxStamp } from './tmux-bundle.ts';

const SYSTEM = [
  '/out/bin/tmux:',
  '\t/usr/lib/libncurses.5.4.dylib (compatibility version 5.4.0, current version 5.4.0)',
  '\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1356.0.0)',
  '\t/usr/lib/libresolv.9.dylib (compatibility version 1.0.0, current version 1.0.0)',
  '',
].join('\n');
const HOMEBREW = `${SYSTEM}\t/opt/homebrew/opt/libevent/lib/libevent_core-2.1.7.dylib (compatibility version 8.0.0)\n`;

describe('the bundled tmux', () => {
  it('pins both source tarballs by sha256', () => {
    expect(TMUX.sha256).toBe('e79c699c7e949dccd0a4a125e17b8d1261e311b16979dbc8eb34542f3966d82e');
    expect(LIBEVENT.sha256).toBe(
      'f7e9383b8c0baa81b687e5b5eecc01beefaf1b19b64151d95ed61647fe7a315c',
    );
    expect(tmuxStamp()).toContain(TMUX.sha256);
    expect(tmuxStamp()).toContain(LIBEVENT.sha256);
  });

  it('builds each architecture with its own compiler target and folder', () => {
    expect([clangArch('x64'), hostTriple('x64')]).toEqual(['x86_64', 'x86_64-apple-darwin']);
    expect([clangArch('arm64'), hostTriple('arm64')]).toEqual(['arm64', 'aarch64-apple-darwin']);
    expect(tmuxBuiltDir('/repo', 'arm64')).toBe('/repo/.local/tmux/arm64');
  });

  it('accepts a binary for the right CPU that links only system libraries', () => {
    expect(foreignLibraries(SYSTEM)).toEqual([]);
    expect(binaryProblems('arm64', { archs: 'arm64\n', otool: SYSTEM, minOs: '12.0' })).toEqual([]);
    expect(binaryProblems('x64', { archs: 'x86_64\n', otool: SYSTEM, minOs: null })).toEqual([]);
  });

  it('names what is wrong with a binary for another CPU, a Homebrew library or a newer macOS', () => {
    expect(foreignLibraries(HOMEBREW)).toEqual([
      '/opt/homebrew/opt/libevent/lib/libevent_core-2.1.7.dylib',
    ]);
    const problems = binaryProblems('arm64', { archs: 'x86_64\n', otool: HOMEBREW, minOs: '15.0' });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain('x86_64, not arm64');
    expect(problems[1]).toContain('libevent_core');
    expect(problems[2]).toContain('macOS 15.0');
  });

  it('reads the minimum macOS from the load commands', () => {
    expect(minimumOs('      cmd LC_BUILD_VERSION\n    minos 12.0\n      sdk 26.2\n')).toBe('12.0');
    expect(minimumOs('nothing here')).toBeNull();
  });
});
