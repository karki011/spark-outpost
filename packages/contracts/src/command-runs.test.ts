import { describe, expect, it } from 'vitest';
import { createOutputSanitizer, outputTail, plainOutput, sanitizeOutput } from './command-runs.ts';

const ESC = '\u001b';
const BEL = '\u0007';

describe('sanitizeOutput', () => {
  it('keeps text, newlines and colour codes', () => {
    const coloured = `${ESC}[1;32mok${ESC}[0m first\r\n\tsecond${ESC}[K\n`;
    expect(sanitizeOutput(coloured)).toBe(coloured);
  });

  it('drops title changes, clipboard writes and hyperlinks', () => {
    const hostile = [
      `${ESC}]0;owned title${BEL}`,
      `${ESC}]2;owned again${ESC}\\`,
      `${ESC}]52;c;c3RvbGVu${BEL}`,
      `${ESC}]8;;https://evil.example${BEL}click${ESC}]8;;${BEL}`,
    ].join('');
    expect(sanitizeOutput(`a${hostile}b`)).toBe('aclickb');
  });

  it('drops sequences that ask the terminal to answer or change its modes', () => {
    const queries = `${ESC}[6n${ESC}[c${ESC}[>0c${ESC}[?1049h${ESC}[?25l${ESC}[18t${ESC}P+q544e${ESC}\\${ESC}c`;
    expect(sanitizeOutput(`x${queries}y\u0005z`)).toBe('xyz');
  });

  it('drops screen clears and other cursor addressing but keeps simple cursor moves', () => {
    expect(sanitizeOutput(`a${ESC}[2J${ESC}[3J${ESC}[10;4Hb${ESC}[2A${ESC}[5Gc`)).toBe(
      `ab${ESC}[2A${ESC}[5Gc`,
    );
  });

  it('drops 8-bit control characters so they cannot open a sequence', () => {
    expect(sanitizeOutput('a\u009b6n\u009d0;t\u009cb\u0000\u007fc')).toBe('a6n0;tbc');
  });

  it('holds its place when a sequence is split across chunks', () => {
    const sanitizer = createOutputSanitizer();
    const pieces = ['safe ', `${ESC}`, ']52;c;c3Rv', `bGVu${BEL}`, ' after ', `${ESC}[3`, '1mred'];
    expect(pieces.map((piece) => sanitizer.push(piece)).join('')).toBe(`safe  after ${ESC}[31mred`);
  });

  it('never lets an unterminated string sequence leak later output as text', () => {
    const sanitizer = createOutputSanitizer();
    expect(sanitizer.push(`${ESC}]52;c;`)).toBe('');
    expect(sanitizer.push('still inside the clipboard write')).toBe('');
    expect(sanitizer.push(`${BEL}visible`)).toBe('visible');
  });

  it('gives up on an overlong control sequence instead of buffering it', () => {
    expect(sanitizeOutput(`${ESC}[${'1;'.repeat(60)}mtext`)).not.toContain(ESC);
  });
});

describe('plainOutput', () => {
  it('removes colour codes and keeps what a carriage return left on the line', () => {
    expect(plainOutput(`${ESC}[32m✓${ESC}[0m done\r\n 10%\r 50%\r100%\nend`)).toBe(
      '✓ done\n100%\nend',
    );
  });
});

describe('outputTail', () => {
  it('returns short text unchanged', () => {
    expect(outputTail('abc', 10)).toBe('abc');
  });

  it('keeps the end and starts at a line boundary when one is near', () => {
    const text = Array.from({ length: 50 }, (_, row) => `line ${row}`).join('\n');
    const tail = outputTail(text, 40);
    expect(tail.length).toBeLessThanOrEqual(40);
    expect(tail.startsWith('line ')).toBe(true);
    expect(text.endsWith(tail)).toBe(true);
  });

  it('does not start in the middle of a surrogate pair', () => {
    const tail = outputTail(`${'a'.repeat(5)}😀${'b'.repeat(4)}`, 5);
    expect(tail).toBe('bbbb');
  });
});
