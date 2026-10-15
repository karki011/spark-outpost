import { describe, expect, it } from 'vitest';
import type { QueuedMessage } from '@spark-outpost/contracts';
import { canEdit, inOrder, movedIds, queueMode, queueNote, queuedItem } from './queue-model.ts';

function item(id: string, position: number): QueuedMessage {
  return { id, content: id, position, continueRunId: null, createdAt: '2026-10-02T10:00:00Z' };
}

const items = [item('a', 1), item('b', 2), item('c', 3)];

describe('queue model', () => {
  it('waits while a turn runs, sends next after a success, and pauses after a stop or failure', () => {
    expect(queueMode(true, [{ status: 'cancelled' }], false)).toBe('waiting');
    expect(queueMode(false, [], false)).toBe('next');
    expect(queueMode(false, [{ status: 'failed' }, { status: 'succeeded' }], false)).toBe('next');
    expect(queueMode(false, [{ status: 'cancelled' }], false)).toBe('paused');
    expect(queueMode(false, [{ status: 'failed' }], false)).toBe('paused');
  });

  it('holds the queue while Spark is paused, once the running turn has ended', () => {
    expect(queueMode(true, [{ status: 'running' }], true)).toBe('waiting');
    expect(queueMode(false, [{ status: 'succeeded' }], true)).toBe('held');
    expect(queueNote('held', 1)).toBe('Held while Spark is paused. Send one now to go on.');
  });

  it('says when queued messages go', () => {
    expect(queueNote('waiting', 1)).toBe('Sends when this turn ends');
    expect(queueNote('waiting', 3)).toBe('Send in order when this turn ends');
    expect(queueNote('paused', 2)).toMatch(/^Paused because the last turn stopped/);
  });

  it('moves one message up or down and refuses to move past either end', () => {
    expect(movedIds(items, 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(movedIds(items, 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(movedIds(items, 'a', -1)).toBeNull();
    expect(movedIds(items, 'c', 1)).toBeNull();
    expect(movedIds(items, 'missing', 1)).toBeNull();
  });

  it('reorders by id, renumbers positions and drops ids that are gone', () => {
    expect(inOrder(items, ['c', 'gone', 'a', 'b'])).toEqual([
      { ...items[2], position: 1 },
      { ...items[0], position: 2 },
      { ...items[1], position: 3 },
    ]);
  });

  it('lets the user edit their own queued message and not a request from an outpost', () => {
    expect(canEdit(item('a', 1))).toBe(true);
    expect(canEdit({ ...item('a', 1), outpostPostId: null })).toBe(true);
    expect(canEdit({ ...item('a', 1), outpostPostId: 'post-1' })).toBe(false);
  });

  it('adds a new message after the last one', () => {
    expect(queuedItem('d', 'next', items)).toMatchObject({ id: 'd', content: 'next', position: 4 });
    expect(queuedItem('d', 'first', [])).toMatchObject({ position: 1 });
  });
});
