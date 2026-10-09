import { describe, expect, it } from 'vitest';
import { isLongMarkdown, splitQuestion } from './answer-text.ts';

describe('isLongMarkdown', () => {
  it('does not count the target of a link, which is never shown', () => {
    const target = `/private/tmp/${'folder/'.repeat(60)}NOTES.md`;

    expect(isLongMarkdown(`Added [NOTES.md](${target}) with one line.`)).toBe(false);
  });

  it('counts the text that is shown', () => {
    expect(isLongMarkdown('word '.repeat(80))).toBe(true);
    expect(isLongMarkdown('one\n\ntwo\n\nthree')).toBe(true);
    expect(isLongMarkdown('one\n\ntwo')).toBe(false);
  });
});

describe('splitQuestion', () => {
  it('separates what the chat said from what it needs', () => {
    expect(splitQuestion('I found two shapes.\n\nNeeds you: pick v1 or v2.')).toEqual({
      said: 'I found two shapes.',
      asks: ['pick v1 or v2.'],
    });
  });

  it('keeps the text around the ask and every ask', () => {
    expect(splitQuestion('Before.\n\nNeeds you: one\n\nBetween.\n\n Needs you: two')).toEqual({
      said: 'Before.\n\nBetween.',
      asks: ['one', 'two'],
    });
  });

  it('has nothing said when the reply was only the ask, and no empty ask', () => {
    expect(splitQuestion('Needs you: which region?')).toEqual({
      said: '',
      asks: ['which region?'],
    });
    expect(splitQuestion('Needs you: ')).toEqual({ said: '', asks: [] });
  });

  it('leaves a reply with no ask whole', () => {
    expect(
      splitQuestion('The shape is v2.\nNeeds you: is not at the start of a paragraph.'),
    ).toEqual({
      said: 'The shape is v2.\nNeeds you: is not at the start of a paragraph.',
      asks: [],
    });
  });
});
