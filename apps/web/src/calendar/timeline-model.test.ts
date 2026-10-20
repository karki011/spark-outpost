import { describe, expect, it } from 'vitest';
import { at, event } from './test-fixtures.ts';
import { block, blockRows, placeEvents } from './timeline-model.ts';

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

describe('blockRows', () => {
  const span = { start: at(8), end: at(18) };
  const rows = (minutes: number) =>
    blockRows(block(at(14), at(14) + minutes * 60_000, span).height);

  it('fits one line in a 15-minute block and two in a 30-minute one', () => {
    expect(rows(15)).toEqual({ rows: 1, titleLines: 1 });
    expect(rows(30)).toEqual({ rows: 2, titleLines: 1 });
  });

  it('adds the tags line once there is room and a second title line after that', () => {
    expect(rows(45)).toEqual({ rows: 3, titleLines: 1 });
    expect(rows(60)).toEqual({ rows: 3, titleLines: 2 });
  });
});
