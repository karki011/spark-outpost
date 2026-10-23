import { describe, expect, it } from 'vitest';
import {
  linkEdit,
  linkTarget,
  toggleCodeBlock,
  toggleLinePrefix,
  unlinkEdit,
} from './md-block-format.ts';
import { toggleInline, type Edit, type InlineFormat } from './md-format.ts';

function apply(text: string, edit: Edit): string {
  const next = text.slice(0, edit.start) + edit.insert + text.slice(edit.end);
  const selected = next.slice(edit.selectStart, edit.selectEnd);
  return edit.selectStart === edit.selectEnd
    ? `${next.slice(0, edit.selectStart)}|${next.slice(edit.selectStart)}`
    : next.replace(selected, `[${selected}]`);
}

function marked(sample: string): { text: string; start: number; end: number } {
  const start = sample.indexOf('[');
  if (start === -1) {
    const caret = sample.indexOf('|');
    return { text: sample.replace('|', ''), start: caret, end: caret };
  }
  const end = sample.indexOf(']') - 1;
  return { text: sample.replace('[', '').replace(']', ''), start, end };
}

function inline(sample: string, format: InlineFormat): string {
  const { text, start, end } = marked(sample);
  return apply(text, toggleInline(text, start, end, format));
}

describe('inline shortcuts', () => {
  it('wraps the selection and keeps it selected', () => {
    expect(inline('a [word] b', 'bold')).toBe('a **[word]** b');
    expect(inline('a [word] b', 'italic')).toBe('a _[word]_ b');
    expect(inline('a [word] b', 'code')).toBe('a `[word]` b');
    expect(inline('a [word] b', 'strike')).toBe('a ~~[word]~~ b');
  });

  it('unwraps when the markers sit just outside or inside the selection', () => {
    expect(inline('a **[word]** b', 'bold')).toBe('a [word] b');
    expect(inline('a [**word**] b', 'bold')).toBe('a [word] b');
    expect(inline('a _[word]_ b', 'italic')).toBe('a [word] b');
    expect(inline('a *[word]* b', 'italic')).toBe('a [word] b');
    expect(inline('a `[word]` b', 'code')).toBe('a [word] b');
    expect(inline('a ~~[word]~~ b', 'strike')).toBe('a [word] b');
  });

  it('tells bold and italic apart', () => {
    expect(inline('**[word]**', 'italic')).toBe('**_[word]_**');
    expect(inline('***[word]***', 'bold')).toBe('*[word]*');
    expect(inline('***[word]***', 'italic')).toBe('**[word]**');
  });

  it('sizes the code delimiters to the backticks in the selection', () => {
    expect(inline('a [b`c] d', 'code')).toBe('a ``[b`c]`` d');
    expect(inline('const [value = `x`]', 'code')).toBe('const `` [value = `x`] ``');
    expect(inline('const `` [value = `x`] ``', 'code')).toBe('const [value = `x`]');
    expect(inline('a [``b`` c``d``]', 'code')).toBe('a ``` [``b`` c``d``] ```');
  });

  it('keeps spaces outside the markers', () => {
    expect(inline('a[ word ]b', 'bold')).toBe('a **[word]** b');
  });

  it('inserts an empty pair at the caret and removes it again', () => {
    expect(inline('a |b', 'bold')).toBe('a **|**b');
    expect(inline('a **|**b', 'bold')).toBe('a |b');
  });

  it('wraps each line of a selection that spans lines, and unwraps them together', () => {
    expect(inline('[one\n\ntwo]', 'bold')).toBe('[**one**\n\n**two**]');
    expect(inline('[**one**\n**two**]', 'bold')).toBe('[one\ntwo]');
  });
});

function lines(sample: string, run: (text: string, start: number, end: number) => Edit) {
  const { text, start, end } = marked(sample);
  return apply(text, run(text, start, end));
}

describe('line formats', () => {
  it('adds and removes list and quote prefixes on every selected line', () => {
    const bullet = (text: string, start: number, end: number) =>
      toggleLinePrefix(text, start, end, 'bullet');
    const numbered = (text: string, start: number, end: number) =>
      toggleLinePrefix(text, start, end, 'numbered');
    const quote = (text: string, start: number, end: number) =>
      toggleLinePrefix(text, start, end, 'quote');
    expect(lines('[a\nb]', bullet)).toBe('[- a\n- b]');
    expect(lines('[- a\n- b]', bullet)).toBe('[a\nb]');
    expect(lines('[a\n\nb]', numbered)).toBe('[1. a\n\n2. b]');
    expect(lines('[- a\n- b]', numbered)).toBe('[1. a\n2. b]');
    expect(lines('x|y', quote)).toBe('> x|y');
    expect(lines('> x|y', quote)).toBe('x|y');
  });

  it('wraps lines in a fence and unwraps the fence around the caret', () => {
    expect(lines('[a\nb]', toggleCodeBlock)).toBe('```\n[a\nb]\n```');
    expect(lines('|', toggleCodeBlock)).toBe('```\n|\n```');
    expect(lines('[say ```x```]', toggleCodeBlock)).toBe('````\n[say ```x```]\n````');
    expect(lines('```ts\na|\n```\nafter', toggleCodeBlock)).toBe('[a]\nafter');
  });
});

describe('links', () => {
  it('turns the selection into the link text', () => {
    const target = linkTarget('see the ticket now', 4, 14);
    expect(target).toMatchObject({ label: 'the ticket', url: '', existing: false });
    expect(apply('see the ticket now', linkEdit(target, 'the ticket', 'https://x.test/1'))).toBe(
      'see [the ticket](https://x.test/1)| now',
    );
  });

  it('treats a selected address as the link', () => {
    const text = 'go https://x.test';
    expect(linkTarget(text, 3, text.length)).toMatchObject({ label: '', url: 'https://x.test' });
    expect(apply(text, linkEdit(linkTarget(text, 3, text.length), '', 'https://x.test'))).toBe(
      'go [https://x.test](https://x.test)|',
    );
  });

  it('finds the link around the caret to edit or remove it', () => {
    const text = 'See [the ticket](https://x.test/1) now';
    const target = linkTarget(text, 8, 8);
    expect(target).toMatchObject({ label: 'the ticket', url: 'https://x.test/1', existing: true });
    expect(apply(text, linkEdit(target, 'it', 'https://x.test/2'))).toBe(
      'See [it](https://x.test/2)| now',
    );
    expect(apply(text, unlinkEdit(target))).toBe('See [the ticket] now');
  });
});
