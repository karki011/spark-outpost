import { describe, expect, it } from 'vitest';
import { clipProse, trimPiecesBlock } from './pieces-trim.ts';

describe('trimming a pieces block', () => {
  it('cuts prose at a word boundary and ends with an ellipsis', () => {
    const text = 'Store the tags per project and list them newest first';
    expect(clipProse(text, 30)).toBe('Store the tags per project…');
    expect(clipProse(text, 200)).toBe(text);
    expect(clipProse('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('leaves a block within the limits, or one that is not a pieces block, untouched', () => {
    const block = { pieces: [{ key: 'P1', title: 't', goal: 'g', acceptance: ['a'] }] };
    expect(trimPiecesBlock(block)).toEqual({ block: { ...block }, trimmed: [] });
    expect(trimPiecesBlock('not json')).toEqual({ block: 'not json', trimmed: [] });
    expect(trimPiecesBlock({ pieces: 'x' }).trimmed).toEqual([]);
  });
});
