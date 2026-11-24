import { describe, expect, it } from 'vitest';
import { createViewHold } from './view-hold.ts';

function held() {
  const sent: string[] = [];
  const hold = createViewHold((data) => sent.push(data));
  return { hold, sent };
}

describe('createViewHold', () => {
  it('passes output through until paused and drops it while held', () => {
    const { hold, sent } = held();
    hold.output('one');
    hold.pause();
    hold.output('two');
    expect(sent).toEqual(['one']);
  });

  it('resets text attributes on resume and does nothing when not held', () => {
    const { hold, sent } = held();
    hold.resume();
    hold.pause();
    hold.resume();
    expect(sent).toEqual(['\x1b[0m\r\n']);
  });

  it('leaves the alternate screen on resume when the view left it while held', () => {
    const { hold, sent } = held();
    hold.output('\x1b[?1049h');
    hold.pause();
    hold.output('menu\x1b[?10');
    hold.output('49lback');
    hold.resume();
    expect(sent).toEqual(['\x1b[?1049h', '\x1b[?1049l\x1b[0m\r\n']);
  });

  it('replays only the last screen switch seen while held, once', () => {
    const { hold, sent } = held();
    hold.pause();
    hold.output('\x1b[?1049l\x1b[?1049h');
    hold.resume();
    hold.pause();
    hold.resume();
    expect(sent).toEqual(['\x1b[?1049h\x1b[0m\r\n', '\x1b[0m\r\n']);
  });
});
