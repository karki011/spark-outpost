import { describe, expect, it } from 'vitest';
import { cleanTitle, createTitleFilter, hidesTitleLine, splitTitle } from './title-line.ts';

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

  it('takes a Title line that opens the reply, whatever follows it', () => {
    expect(splitTitle('Title: A heading\nOne.\nTwo.\nThree.')).toEqual({
      text: 'One.\nTwo.\nThree.',
      title: 'A heading',
    });
    expect(splitTitle(`\n**Title:** A heading\n\n# Plan\n${'x'.repeat(41)}`)).toEqual({
      text: `\n# Plan\n${'x'.repeat(41)}`,
      title: 'A heading',
    });
    expect(splitTitle('Title: A heading\n')).toEqual({ text: '', title: 'A heading' });
  });

  it('keeps a Title line inside the reply that more than two lines or a long line follow', () => {
    const three = 'Done.\nTitle: A heading\nOne.\nTwo.\nThree.';
    expect(splitTitle(three)).toEqual({ text: three, title: null });
    const long = `Done.\nTitle: A heading\n${'x'.repeat(41)}`;
    expect(splitTitle(long)).toEqual({ text: long, title: null });
    const edge = `Done.\nTitle: A heading\n${'x'.repeat(40)}`;
    expect(splitTitle(edge)).toEqual({ text: `Done.\n${'x'.repeat(40)}`, title: 'A heading' });
  });

  it('keeps the reply whole when the title is missing, mid-reply, or unusable', () => {
    expect(splitTitle('Just an answer.')).toEqual({ text: 'Just an answer.', title: null });
    const middle =
      'Intro.\nTitle: A heading\nThen the reply goes on with an ordinary sentence of prose.';
    expect(splitTitle(middle)).toEqual({ text: middle, title: null });
    const long = `Done.\nTitle: ${'word '.repeat(12)}`;
    expect(splitTitle(long)).toEqual({ text: long, title: null });
    expect(splitTitle('Done.\nTitle:   ')).toEqual({ text: 'Done.\nTitle:   ', title: null });
    const opening = `Title: ${'word '.repeat(12)}\nThe reply.`;
    expect(splitTitle(opening)).toEqual({ text: opening, title: null });
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

  it('hides a Title line that opens the reply as soon as the line ends', () => {
    const filter = createTitleFilter();
    expect(filter.push('Tit')).toBe('');
    expect(filter.push('le: Add mean function\n')).toBe('');
    expect(
      filter.push('\n# Add a mean function\n\nA long plan follows, well past forty characters.'),
    ).toBe('# Add a mean function\n\nA long plan follows, well past forty characters.');
    expect(filter.finish()).toEqual({ text: '', title: 'Add mean function' });
  });

  it('hides a Title line that opens the final message, after the commentary before it', () => {
    const filter = createTitleFilter();
    expect(filter.push('I will read the code, then plan.')).toBe(
      'I will read the code, then plan.',
    );
    filter.startMessage(0);
    expect(filter.push('\n\nTitle: Add mean function\n\n# Add a mean function\n')).toBe(
      '\n\n# Add a mean function',
    );
    expect(filter.push('Export it from sum.js and test it there, in one small change.')).toBe(
      '\nExport it from sum.js and test it there, in one small change.',
    );
    expect(filter.finish()).toEqual({ text: '', title: 'Add mean function' });
  });

  it('counts the text still on its way when a message starts', () => {
    const filter = createTitleFilter();
    expect(filter.push('Reading the co')).toBe('Reading the co');
    filter.startMessage(3);
    expect(filter.push('de.\n\nTitle: Add mean function\nThe plan is one exported function.')).toBe(
      'de.\n\nThe plan is one exported function.',
    );
    expect(filter.finish().title).toBe('Add mean function');
  });

  it('leaves a Title line alone when the message starts in the middle of a line', () => {
    const filter = createTitleFilter();
    filter.push('See the ');
    filter.startMessage(0);
    const rest = 'Title: field of the form, which is required and long enough to matter.';
    expect(filter.push(rest)).toBe(rest);
    expect(filter.finish()).toEqual({ text: '', title: null });
  });

  it('hides a Title line that closes one message when another message follows', () => {
    const filter = createTitleFilter();
    const first = filter.push('I started two sub-agents.\n\nTitle: Split the route work');
    filter.endMessage(0);
    const second = filter.push(
      '\n\nBoth are done. The routes moved into one module and every test passes now.',
    );
    const ending = filter.finish();
    expect(first + second + ending.text).toBe(
      'I started two sub-agents.\n\nBoth are done. The routes moved into one module and every test passes now.',
    );
    expect(ending.title).toBe('Split the route work');
  });

  it('waits for text still on its way before it looks at the end of the message', () => {
    const filter = createTitleFilter();
    const first = filter.push('Started.\n\nTitle: Split the ro');
    filter.endMessage(8);
    const second = filter.push(
      'ute work\n\nA long closing paragraph follows, well past forty characters.',
    );
    const ending = filter.finish();
    expect(first + second + ending.text).toBe(
      'Started.\n\nA long closing paragraph follows, well past forty characters.',
    );
    expect(ending.title).toBe('Split the route work');
  });

  it('keeps a Title line in the middle of one message', () => {
    const filter = createTitleFilter();
    const text =
      'The form has these fields.\nTitle: Required field\nA long explanation follows, well past forty characters.\n';
    const first = filter.push(text);
    filter.endMessage(0);
    const rest = filter.push('\n\nNext message.');
    expect(first + rest + filter.finish().text).toBe(`${text}\n\nNext message.`);
  });

  it('prefers the title that closes the whole reply', () => {
    const filter = createTitleFilter();
    const first = filter.push('Working.\n\nTitle: First guess');
    filter.endMessage(0);
    const second = filter.push(
      '\n\nAll done, with a long enough closing line to matter here.\n\nTitle: Final name',
    );
    const ending = filter.finish();
    expect(first + second + ending.text).toBe(
      'Working.\n\nAll done, with a long enough closing line to matter here.',
    );
    expect(ending.title).toBe('Final name');
  });

  it('takes the closing Title line over the opening one and hides both', () => {
    const result = streamed([
      'Title: Draft heading\nThis paragraph is clearly longer than a short sign-off line.\n',
      'Title: Explain the draft',
    ]);
    expect(result).toMatchObject({
      text: 'This paragraph is clearly longer than a short sign-off line.',
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

describe('hiding the title line', () => {
  it("applies to every reply of the chat's own run, asked for a title or not", () => {
    expect(hidesTitleLine({ parentRunId: null })).toBe(true);
  });

  it('leaves the reply of a run handed a job as it is', () => {
    expect(hidesTitleLine({ parentRunId: '00000000-0000-4000-8000-000000000001' })).toBe(false);
  });
});
