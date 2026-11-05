import { describe, expect, it } from 'vitest';
import { modeSequences, parseModes, seedText } from './control-seed.ts';

describe('terminal seed after adoption', () => {
  it('reads the pane modes tmux reports', () => {
    expect(parseModes('12 1 4 7 1 [1,7,25,1000,1006,2004]')).toEqual({
      historySize: 12,
      alternate: true,
      cursorX: 4,
      cursorY: 7,
      keypad: true,
      privateModes: [1, 7, 25, 1000, 1006, 2004],
    });
    expect(parseModes('0 0 0 0 0 []').privateModes).toEqual([]);
    expect(parseModes('').historySize).toBe(0);
  });

  it('replays the cursor, mouse, paste, focus and keypad modes and nothing else', () => {
    const modes = parseModes('0 0 2 3 1 [7,1000,1004,1006,1049,2004,2026]');
    expect(modeSequences(modes)).toBe(
      '\x1b[4;3H\x1b[?25l\x1b[?7h\x1b[?1000h\x1b[?1004h\x1b[?1006h\x1b[?2004h\x1b=',
    );
    expect(modeSequences(parseModes('0 0 0 0 0 [25]'))).toBe('\x1b[1;1H\x1b[?25h');
  });

  it('writes scrollback above the visible screen', () => {
    const seed = seedText([['2 0 1 1 0 [25]'], ['old 1', 'old 2'], [], ['now 1', 'now 2']]);
    expect(seed).toBe(
      '\x1b[0mold 1\r\n\x1b[0mold 2\r\n\x1b[0mnow 1\r\n\x1b[0mnow 2\x1b[0m\x1b[2;2H\x1b[?25h',
    );
  });

  it('leaves out scrollback tmux reports as empty', () => {
    const seed = seedText([['0 0 0 0 0 [25]'], ['stale'], [], ['only']]);
    expect(seed).toBe('\x1b[0monly\x1b[0m\x1b[1;1H\x1b[?25h');
  });

  it('puts the saved screen under an alternate screen', () => {
    const seed = seedText([['0 1 0 0 0 [25,1049]'], [], ['shell'], ['full screen']]);
    expect(seed).toBe(
      '\x1b[0mshell\r\n\x1b[?1049h\x1b[H\x1b[0mfull screen\x1b[0m\x1b[1;1H\x1b[?25h',
    );
  });

  it('keeps a hyperlink that capture-pane printed', () => {
    const link = '\x1b]8;;https://example.com\x1b\\docs\x1b]8;;\x1b\\';
    expect(seedText([['0 0 0 0 0 [25]'], [], [], [link]])).toContain(link);
  });
});
