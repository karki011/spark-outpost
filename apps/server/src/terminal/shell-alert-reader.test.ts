import { describe, expect, it } from 'vitest';
import { shellAlertReader } from './shell-alert-reader.ts';

const ESC = '\x1b';
const BEL = '\x07';
const ST = `${ESC}\\`;

function read(...chunks: string[]): string[] {
  const reader = shellAlertReader();
  return chunks.flatMap((chunk) => reader(chunk));
}

describe('shell alerts in terminal output', () => {
  it('reads OSC 9, OSC 777 and OSC 99 with either terminator', () => {
    expect(read(`build ${ESC}]9;Build done${BEL} ok`)).toEqual(['Build done']);
    expect(read(`${ESC}]9;Build done${ST}`)).toEqual(['Build done']);
    expect(read(`${ESC}]777;notify;Tests;All 40 passed${BEL}`)).toEqual(['Tests: All 40 passed']);
    expect(read(`${ESC}]99;;Deploy finished${ST}`)).toEqual(['Deploy finished']);
  });

  it('joins a sequence split across output chunks', () => {
    expect(read(`one ${ESC}`, `]9;Bui`, `ld done`, BEL)).toEqual(['Build done']);
    expect(read(`${ESC}]777;notify;Tests;ok${ESC}`, '\\')).toEqual(['Tests: ok']);
  });

  it('drops a sequence a stray escape breaks and reads the next one', () => {
    expect(read(`${ESC}]9;broken ${ESC}[0m text ${ESC}]9;whole${BEL}`)).toEqual(['whole']);
    expect(read(`${ESC}]9;broken`, `${ESC}]0;title${BEL}`, `${ESC}]9;next${BEL}`)).toEqual([
      'next',
    ]);
  });

  it('ignores ConEmu progress and other OSC 9 commands', () => {
    expect(read(`${ESC}]9;4;1;50${BEL}`, `${ESC}]9;4;0${BEL}`, `${ESC}]9;9;/tmp${ST}`)).toEqual([]);
  });

  it('ignores other OSC codes and OSC 777 that is not a notification', () => {
    expect(read(`${ESC}]0;window title${BEL}${ESC}]777;precmd${BEL}`)).toEqual([]);
    expect(read(`${ESC}]8;;https://example.com${ST}link${ESC}]8;;${ST}`)).toEqual([]);
  });

  it('joins kitty title and body parts and decodes base64', () => {
    expect(read(`${ESC}]99;i=1:d=0;Build${ST}`, `${ESC}]99;i=1:p=body;finished${ST}`)).toEqual([
      'Build: finished',
    ]);
    const encoded = Buffer.from('Café ready').toString('base64');
    expect(read(`${ESC}]99;e=1;${encoded}${ST}`)).toEqual(['Café ready']);
    expect(read(`${ESC}]99;p=close;${ST}`)).toEqual([]);
  });

  it('drops an overlong sequence and keeps reading after it', () => {
    const long = `${ESC}]9;${'x'.repeat(2000)}${BEL}`;
    expect(read(long, `${ESC}]9;after${BEL}`)).toEqual(['after']);
    expect(read(`${ESC}]9;${'y'.repeat(2000)}`, `${ESC}]9;next${BEL}`)).toEqual(['next']);
  });

  it('strips control and direction characters and caps the text', () => {
    expect(read(`${ESC}]9;Done‮ gnp.exe\u0001 now${BEL}`)).toEqual(['Done gnp.exe now']);
    const [capped] = read(`${ESC}]9;${'a'.repeat(400)}${BEL}`);
    expect(capped).toHaveLength(200);
    expect(capped?.endsWith('…')).toBe(true);
    expect(read(`${ESC}]9;   ${BEL}`)).toEqual([]);
  });
});
