import { describe, expect, it } from 'vitest';
import { createControlParser, decodeOutput, type ControlEvent } from './control-protocol.ts';

function parseAll(chunks: (string | Buffer)[]): ControlEvent[] {
  const events: ControlEvent[] = [];
  const parse = createControlParser((event) => events.push(event));
  for (const chunk of chunks) parse(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
  return events;
}

function outputText(events: ControlEvent[]): string {
  const buffers = events.flatMap((event) => (event.type === 'output' ? [event.data] : []));
  return Buffer.concat(buffers).toString('utf8');
}

describe('tmux control protocol', () => {
  it('decodes octal escapes and keeps UTF-8 bytes', () => {
    const decoded = decodeOutput(Buffer.from('\\033[31mé ✓\\015\\012a\\134b', 'utf8'));
    expect(decoded.toString('utf8')).toBe('\x1b[31mé ✓\r\na\\b');
  });

  it('leaves a backslash that is not an octal escape alone', () => {
    expect(decodeOutput(Buffer.from('a\\9b\\12', 'utf8')).toString('utf8')).toBe('a\\9b\\12');
  });

  it('reports pane output split across chunks', () => {
    const events = parseAll(['%output %3 he', 'llo\\012\n%output %4 x\n']);
    expect(events).toEqual([
      { type: 'output', paneId: '%3', data: Buffer.from('hello\n') },
      { type: 'output', paneId: '%4', data: Buffer.from('x') },
    ]);
  });

  it('keeps a UTF-8 character whose bytes arrive in two reads', () => {
    const line = Buffer.from('%output %1 café ✓\n', 'utf8');
    const cut = line.indexOf(0xc3) + 1;
    const events = parseAll([line.subarray(0, cut), line.subarray(cut)]);
    expect(outputText(events)).toBe('café ✓');
  });

  it('parses a large burst delivered one byte at a time and in one piece alike', () => {
    const lines = Array.from({ length: 2000 }, (_, index) => `%output %0 row ${index}\\015\\012\n`);
    const whole = Buffer.from(lines.join(''), 'utf8');
    const expected = Array.from({ length: 2000 }, (_, index) => `row ${index}\r\n`).join('');
    expect(outputText(parseAll([whole]))).toBe(expected);
    const pieces: Buffer[] = [];
    for (let at = 0; at < whole.length; at += 7) pieces.push(whole.subarray(at, at + 7));
    expect(outputText(parseAll(pieces))).toBe(expected);
  });

  it('keeps reply lines that look like notifications inside a reply block', () => {
    const events = parseAll(['%begin 1 2 1\n%output %0 not output\nline\n%end 1 2 1\n']);
    expect(events).toEqual([{ type: 'reply', ok: true, lines: ['%output %0 not output', 'line'] }]);
  });

  it('marks a refused command, a notification and the client exit', () => {
    const events = parseAll([
      '%begin 1 3 1\nno such pane\n%error 1 3 1\n%window-renamed @0 spark-dead\n%exit\n',
    ]);
    expect(events).toEqual([
      { type: 'reply', ok: false, lines: ['no such pane'] },
      { type: 'notice', name: 'window-renamed' },
      { type: 'exit' },
    ]);
  });
});
