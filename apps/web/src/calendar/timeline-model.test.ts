import { describe, expect, it } from 'vitest';
import { at, event } from './test-fixtures.ts';
import { placeEvents } from './timeline-model.ts';

const layout = (events: ReturnType<typeof event>[]) =>
  Object.fromEntries(
    placeEvents(events).map(({ event: item, lane, lanes, span }) => [
      item.title,
      { lane, lanes, span },
    ]),
  );

describe('placeEvents', () => {
  it('gives short meetings beside a long block half the width, not a third', () => {
    const placed = layout([
      event('Offsite', at(9), at(13)),
      event('Standup', at(9), at(9, 30)),
      event('1:1', at(10), at(10, 30)),
      event('Review', at(11), at(11, 30)),
    ]);
    expect(placed).toEqual({
      Offsite: { lane: 0, lanes: 2, span: 1 },
      Standup: { lane: 1, lanes: 2, span: 1 },
      '1:1': { lane: 1, lanes: 2, span: 1 },
      Review: { lane: 1, lanes: 2, span: 1 },
    });
  });

  it('lets a meeting spread into columns that are free beside it', () => {
    const placed = layout([
      event('Offsite', at(9), at(13)),
      event('Standup', at(9), at(9, 30)),
      event('Pairing', at(9, 15), at(10)),
      event('Review', at(11), at(11, 30)),
    ]);
    expect(placed.Offsite).toEqual({ lane: 0, lanes: 3, span: 1 });
    expect(placed.Pairing).toEqual({ lane: 2, lanes: 3, span: 1 });
    expect(placed.Review).toEqual({ lane: 1, lanes: 3, span: 2 });
  });

  it('starts over after a gap so a later meeting gets the full width', () => {
    const placed = layout([
      event('A', at(9), at(10)),
      event('B', at(9, 30), at(10)),
      event('Lunch', at(12), at(13)),
    ]);
    expect(placed.Lunch).toEqual({ lane: 0, lanes: 1, span: 1 });
    expect(placed.B).toEqual({ lane: 1, lanes: 2, span: 1 });
  });
});
