import { describe, expect, it } from 'vitest';
import { joinCommandLine, shortHome, splitCommandLine } from './mcp-command-line.ts';

describe('splitCommandLine', () => {
  it('splits on spaces and keeps quoted words together', () => {
    expect(splitCommandLine(`npx -y "@scope/server name" 'a "b"' c\\ d`)).toEqual({
      ok: true,
      parts: ['npx', '-y', '@scope/server name', 'a "b"', 'c d'],
    });
  });

  it('keeps empty quoted arguments and escaped quotes inside double quotes', () => {
    expect(splitCommandLine(`run "" "say \\"hi\\""`)).toEqual({
      ok: true,
      parts: ['run', '', 'say "hi"'],
    });
  });

  it('reports an unclosed quote', () => {
    expect(splitCommandLine(`sh -c 'echo`)).toEqual({ ok: false, error: 'Close the quote.' });
  });
});

describe('joinCommandLine', () => {
  it('round-trips arguments that need quoting', () => {
    const parts = ['/bin/sh', '-c', "echo it's >&2", '', 'plain-arg'];
    const line = joinCommandLine(parts);
    expect(line).toBe(`/bin/sh -c 'echo it'\\''s >&2' '' plain-arg`);
    expect(splitCommandLine(line)).toEqual({ ok: true, parts });
  });
});

describe('shortHome', () => {
  it('replaces home folders with ~ wherever a path starts', () => {
    expect(shortHome('/Users/ana/bin/tool --root=/home/ana/work /Users/ana')).toBe(
      '~/bin/tool --root=~/work ~',
    );
  });

  it('leaves other paths alone', () => {
    expect(shortHome('/usr/local/bin/node /tmp/Users/x')).toBe('/usr/local/bin/node /tmp/Users/x');
  });
});
