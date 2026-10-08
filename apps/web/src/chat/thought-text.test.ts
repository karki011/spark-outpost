import { describe, expect, it } from 'vitest';
import { thoughtText } from './thought-text.ts';

describe('thinking text', () => {
  it('drops the emphasis markers an agent puts around a heading or a phrase', () => {
    expect(thoughtText('**Planning the change**\n\nI will add `clamp` and **test it**.')).toBe(
      'Planning the change\n\nI will add `clamp` and test it.',
    );
  });

  it('keeps asterisks and underscores that are not bold markers', () => {
    expect(thoughtText('2 ** 10 is 1024; call __init__ and a * b')).toBe(
      '2 ** 10 is 1024; call __init__ and a * b',
    );
    expect(thoughtText('- step one\n* step two')).toBe('- step one\n* step two');
  });

  it('leaves a marker that is still open while the text streams', () => {
    expect(thoughtText('**Planning the')).toBe('**Planning the');
  });
});
