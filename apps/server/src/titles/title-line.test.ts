import { describe, expect, it } from 'vitest';
import { cleanTitle, createTitleFilter, splitTitle } from './title-line.ts';

function streamed(deltas: readonly string[]) {
  const filter = createTitleFilter();
  const shown = deltas.map((delta) => filter.push(delta));
  const ending = filter.finish();
  return { shown, text: shown.join('') + ending.text, title: ending.title };
}

describe('title line', () => {
  it('splits a trailing Title line from the reply', () => {
    expect(splitTitle('Moved the helpers.\n\nTitle: Move date helpers into dates.ts')).toEqual({
      text: 'Moved the helpers.',
      title: 'Move date helpers into dates.ts',
    });
    expect(splitTitle('Done.\n**Title:** "fix off-by-one in date divider."\n\n')).toEqual({
      text: 'Done.',
      title: 'Fix off-by-one in date divider',
    });
  });

  it('keeps the reply whole when the title is missing, mid-reply, or unusable', () => {
    expect(splitTitle('Just an answer.')).toEqual({ text: 'Just an answer.', title: null });
    const middle = 'Title: A heading\nThen more text.';
    expect(splitTitle(middle)).toEqual({ text: middle, title: null });
    const long = `Done.\nTitle: ${'word '.repeat(12)}`;
    expect(splitTitle(long)).toEqual({ text: long, title: null });
    expect(splitTitle('Done.\nTitle:   ')).toEqual({ text: 'Done.\nTitle:   ', title: null });
  });

  it('cleans quotes, trailing periods and spacing into sentence case', () => {
    expect(cleanTitle(' “refactor   format.ts helpers.” ')).toBe('Refactor format.ts helpers');
    expect(cleanTitle('')).toBeNull();
  });
});

describe('title filter', () => {
  it('never streams the title line, even when it arrives in pieces', () => {
    const result = streamed(['Moved it.', '\n', '\nTi', 'tle: Move date', ' helpers']);
    expect(result.shown.join('')).toBe('Moved it.');
    expect(result).toMatchObject({ text: 'Moved it.', title: 'Move date helpers' });
  });

  it('releases held text as soon as the line cannot be a title', () => {
    const filter = createTitleFilter();
    expect(filter.push('First line\nTi')).toBe('First line');
    expect(filter.push('ny change')).toBe('\nTiny change');
    expect(filter.finish()).toEqual({ text: '', title: null });
  });

  it('streams a reply without a title unchanged', () => {
    const deltas = ['Hello ', 'there.\n', 'Second line', ' ends here.'];
    const result = streamed(deltas);
    expect(result.text).toBe(deltas.join(''));
    expect(result.title).toBeNull();
  });

  it('holds a Title line that is followed by more text, then gives it back', () => {
    const result = streamed(['Intro\nTitle: Not the end\n', 'More words.']);
    expect(result).toMatchObject({ text: 'Intro\nTitle: Not the end\nMore words.', title: null });
  });

  it('does not treat a title word inside a line as the marker', () => {
    const result = streamed(['The Title: field is required.\nTitle: Explain form validation']);
    expect(result).toMatchObject({
      text: 'The Title: field is required.',
      title: 'Explain form validation',
    });
  });
});
