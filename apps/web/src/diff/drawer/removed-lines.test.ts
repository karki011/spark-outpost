// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { markRemovedWords } from './removed-lines.ts';

function chunkOf(...rows: string[]): HTMLElement {
  const chunk = document.createElement('div');
  chunk.innerHTML = rows
    .map((row) => `<div class="cm-deletedLine"><del>${row}</del></div>`)
    .join('');
  return chunk;
}

function rowsOf(chunk: HTMLElement): string[] {
  return Array.from(chunk.querySelectorAll('del'), (row) => row.innerHTML);
}

describe('removed word marks', () => {
  it('wraps a span of plain text', () => {
    const chunk = chunkOf('return old;');
    markRemovedWords(chunk, [{ before: [{ from: 7, to: 10 }], after: [] }]);
    expect(rowsOf(chunk)).toEqual(['return <span class="dd-word">old</span>;']);
  });

  it('keeps syntax spans when a mark starts and ends inside them', () => {
    const chunk = chunkOf(
      '<span class="k">const</span> name = <span class="s">\'old value\'</span>;',
    );
    markRemovedWords(chunk, [{ before: [{ from: 14, to: 23 }], after: [] }]);
    expect(rowsOf(chunk)).toEqual([
      '<span class="k">const</span> name = <span class="s">\'</span>' +
        '<span class="dd-word"><span class="s">old value</span></span>' +
        '<span class="s">\'</span>;',
    ]);
    expect(chunk.textContent).toBe("const name = 'old value';");
  });

  it('puts neighbouring tokens in one mark and handles several marks per line', () => {
    const chunk = chunkOf(
      '<span class="f">load</span>(<span class="v">path</span>, old);',
      'kept();',
    );
    markRemovedWords(chunk, [
      {
        before: [
          { from: 0, to: 9 },
          { from: 11, to: 14 },
        ],
        after: [],
      },
      null,
    ]);
    expect(rowsOf(chunk)).toEqual([
      '<span class="dd-word"><span class="f">load</span>(<span class="v">path</span></span>, ' +
        '<span class="dd-word">old</span>);',
      'kept();',
    ]);
  });

  it('wraps a mark that runs to the end of the line', () => {
    const chunk = chunkOf('value, last');
    markRemovedWords(chunk, [{ before: [{ from: 7, to: 11 }], after: [] }]);
    expect(rowsOf(chunk)).toEqual(['value, <span class="dd-word">last</span>']);
  });
});
