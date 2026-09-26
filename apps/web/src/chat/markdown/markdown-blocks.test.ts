import { describe, expect, it } from 'vitest';
import { splitBlocks } from './markdown-blocks.ts';

describe('splitBlocks', () => {
  it('splits top-level blocks at blank lines and keeps the source intact', () => {
    const text = '# Title\n\nFirst paragraph\nstill first.\n\nSecond paragraph.';
    const blocks = splitBlocks(text);
    expect(blocks).toEqual(['# Title\n', 'First paragraph\nstill first.\n', 'Second paragraph.']);
    expect(blocks.join('\n')).toBe(text);
  });

  it('keeps blank lines inside fenced code in one block', () => {
    const text = 'Intro\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter.';
    expect(splitBlocks(text)).toEqual([
      'Intro\n',
      '```ts\nconst a = 1;\n\nconst b = 2;\n```\n',
      'After.',
    ]);
  });

  it('keeps an unclosed fence as the growing tail', () => {
    expect(splitBlocks('Intro\n\n```py\nprint(1)\n\n')).toEqual(['Intro\n', '```py\nprint(1)\n\n']);
  });

  it('keeps loose list items and indented continuations together', () => {
    const text = '- one\n\n- two\n\n  more about two\n\nDone.';
    expect(splitBlocks(text)).toEqual(['- one\n\n- two\n\n  more about two\n', 'Done.']);
  });

  it('leaves text with reference definitions whole', () => {
    const text = 'See [docs][1].\n\n[1]: https://example.com';
    expect(splitBlocks(text)).toEqual([text]);
  });

  it('only changes the last block as streamed text grows', () => {
    const full = 'Alpha one.\n\nBeta two.\n\n```js\nx()\n```\n\nGamma three.';
    let sealed: string[] = [];
    for (let end = 1; end <= full.length; end += 1) {
      const blocks = splitBlocks(full.slice(0, end));
      expect(blocks.slice(0, sealed.length)).toEqual(sealed);
      sealed = blocks.slice(0, -1);
    }
  });
});
