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

  it('takes a Title line followed by one or two short lines and keeps those lines', () => {
    expect(
      splitTitle('It printed five lines.\n\nTitle: View pull request 2233 output\nPINEAPPLE-42'),
    ).toEqual({
      text: 'It printed five lines.\n\nPINEAPPLE-42',
      title: 'View pull request 2233 output',
    });
    expect(splitTitle('Done.\nTitle: Add subtract function\n\nThanks,\nCodex\n')).toEqual({
      text: 'Done.\n\nThanks,\nCodex',
      title: 'Add subtract function',
    });
    expect(splitTitle('Done.\nTitle: First guess\nTitle: Second guess\nBye')).toEqual({
      text: 'Done.\nTitle: First guess\nBye',
      title: 'Second guess',
    });
  });

  it('keeps a Title line that more than two lines or a long line follow', () => {
    const three = 'Title: A heading\nOne.\nTwo.\nThree.';
    expect(splitTitle(three)).toEqual({ text: three, title: null });
    const long = `Title: A heading\n${'x'.repeat(41)}`;
    expect(splitTitle(long)).toEqual({ text: long, title: null });
    const edge = `Done.\nTitle: A heading\n${'x'.repeat(40)}`;
    expect(splitTitle(edge)).toEqual({ text: `Done.\n${'x'.repeat(40)}`, title: 'A heading' });
  });

  it('keeps the reply whole when the title is missing, mid-reply, or unusable', () => {
    expect(splitTitle('Just an answer.')).toEqual({ text: 'Just an answer.', title: null });
    const middle = 'Title: A heading\nThen the reply goes on with an ordinary sentence of prose.';
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
    expect(filter.pending()).toBe(3);
    expect(filter.push('ny change')).toBe('\nTiny change');
    expect(filter.finish()).toEqual({ text: '', title: null });
  });

  it('streams a reply without a title unchanged', () => {
    const deltas = ['Hello ', 'there.\n', 'Second line', ' ends here.'];
    const result = streamed(deltas);
    expect(result.text).toBe(deltas.join(''));
    expect(result.title).toBeNull();
  });

  it('holds a Title line until the text after it is too long to be a sign-off, then gives it back', () => {
    const filter = createTitleFilter();
    expect(filter.push('Intro\nTitle: Not the end\n')).toBe('Intro');
    expect(filter.push('More words.')).toBe('');
    expect(filter.push(' And the reply goes on well past forty characters.')).toBe(
      '\nTitle: Not the end\nMore words. And the reply goes on well past forty characters.',
    );
    expect(filter.finish()).toEqual({ text: '', title: null });
  });

  it('gives a held Title line back when a third line follows it', () => {
    const result = streamed(['Intro\nTitle: Not the end\nOne.\nTwo.\n', 'Three']);
    expect(result.shown.join('')).toBe('Intro\nTitle: Not the end\nOne.\nTwo.\nThree');
    expect(result.title).toBeNull();
  });

  it('never streams a Title line that a short sign-off follows', () => {
    const result = streamed([
      'It printed five lines.\nTit',
      'le: View pull request\nPINE',
      'APPLE-42',
    ]);
    expect(result.shown.join('')).toBe('It printed five lines.');
    expect(result).toMatchObject({
      text: 'It printed five lines.\nPINEAPPLE-42',
      title: 'View pull request',
    });
  });

  it('still hides the final Title line after an earlier one was given back', () => {
    const result = streamed([
      'Title: Draft heading\nThis paragraph is clearly longer than a short sign-off line.\n',
      'Title: Explain the draft',
    ]);
    expect(result).toMatchObject({
      text: 'Title: Draft heading\nThis paragraph is clearly longer than a short sign-off line.',
      title: 'Explain the draft',
    });
  });

  it('does not treat a title word inside a line as the marker', () => {
    const result = streamed(['The Title: field is required.\nTitle: Explain form validation']);
    expect(result).toMatchObject({
      text: 'The Title: field is required.',
      title: 'Explain form validation',
    });
  });
});
