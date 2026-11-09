import { describe, expect, it } from 'vitest';
import { at, event, link } from '../calendar/test-fixtures.ts';
import { homeFocus } from './home-model.ts';

const standup = event('Standup', at(10), at(10, 30), { link: link('zoom') });
const retro = event('Retro', at(10, 20), at(11), { link: link('zoom') });
const quick = event('Check-in', at(10), at(10, 3), { link: link('zoom') });

describe('homeFocus', () => {
  it('gives a meeting the big card until 5 min past its start', () => {
    expect(homeFocus([], [standup], null, at(10, 4, 59))).toEqual({
      kind: 'meeting',
      events: [standup],
    });
    expect(homeFocus([], [standup], null, at(10, 5))).toEqual({ kind: 'clear' });
  });

  it('stops at the end of a meeting shorter than 5 min', () => {
    expect(homeFocus([], [quick], null, at(10, 2, 59))).toMatchObject({ kind: 'meeting' });
    expect(homeFocus([], [quick], null, at(10, 3))).toEqual({ kind: 'clear' });
  });

  it('lets the next meeting have the card while a late one is still on', () => {
    expect(homeFocus([], [standup, retro], null, at(10, 19))).toEqual({
      kind: 'meeting',
      events: [retro],
    });
  });
});
