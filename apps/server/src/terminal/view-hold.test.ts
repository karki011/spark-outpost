import { describe, expect, it } from 'vitest';
import { createViewHold } from './view-hold.ts';

function held(limit?: number) {
  const sent: string[] = [];
  const hold = createViewHold((data) => sent.push(data), limit);
  return { hold, sent };
}

describe('createViewHold', () => {
  it('passes output through until paused and keeps it back while held', () => {
    const { hold, sent } = held();
    hold.output('one');
    hold.pause();
    hold.output('two');
    expect(sent).toEqual(['one']);
  });

  it('sends what was held, as printed, on resume', () => {
    const { hold, sent } = held();
    hold.pause();
    hold.output('\x1b[?25l');
    hold.output('two\r\n\x1b[?25h');
    hold.resume();
    hold.output('three');
    expect(sent).toEqual(['\x1b[?25ltwo\r\n\x1b[?25h', 'three']);
  });

  it('sends nothing on resume when nothing was held or it was not paused', () => {
    const { hold, sent } = held();
    hold.resume();
    hold.pause();
    hold.resume();
    expect(sent).toEqual([]);
  });

  it('keeps the newest lines and the last screen and cursor modes when too much was held', () => {
    const { hold, sent } = held(20);
    hold.output('\x1b[?1049h\x1b[?25l');
    hold.pause();
    hold.output('menu\x1b[?10');
    hold.output('49l\x1b[?25hold line that is long\r\n');
    hold.output('new 1\r\nnew 2\r\n');
    hold.resume();
    expect(sent[1]).toBe('\x1b[?1049l\x1b[?25h\x1b[0m\r\nnew 1\r\nnew 2\r\n');
  });

  it('keeps every private mode switched before the kept lines, one by one', () => {
    const { hold, sent } = held(20);
    hold.pause();
    hold.output('\x1b[?2004h\x1b[?1000;1006h');
    hold.output('\x1b[?1000l' + 'x'.repeat(30) + '\r\nnew\r\n');
    hold.resume();
    expect(sent[0]).toBe('\x1b[?2004h\x1b[?1000l\x1b[?1006h\x1b[0m\r\nnew\r\n');
  });

  it('starts each hold empty', () => {
    const { hold, sent } = held(20);
    hold.pause();
    hold.output('x'.repeat(30));
    hold.resume();
    hold.pause();
    hold.output('next');
    hold.resume();
    expect(sent[1]).toBe('next');
  });
});
