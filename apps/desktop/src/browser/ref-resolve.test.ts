import { describe, expect, it } from 'vitest';
import { outlineOf } from './outline.ts';
import { RefMap, RefNumbers } from './ref-map.ts';
import { el, fakeCdp, axOf, domOf, text, type El, type FakeDocument } from './ref-page.fixture.ts';
import { indexDocument, resolveRef, type RefindFor } from './ref-resolve.ts';

function fruit(base: number, name: string): El {
  return el(base, 'listitem', '', {
    tag: 'LI',
    kids: [
      text(base + 1, name),
      el(base + 2, 'button', 'Delete', { tag: 'BUTTON', attrs: ['type', 'button'] }),
    ],
  });
}

function shop(shift: number, fruits: [number, string][], documentId = 9000): FakeDocument {
  return {
    documentId,
    body: el(1, 'RootWebArea', 'Shop', {
      tag: 'HTML',
      kids: [
        el(10 + shift, 'list', 'Fruits', {
          tag: 'UL',
          kids: fruits.map(([base, name]) => fruit(base + shift, name)),
        }),
        el(20 + shift, 'form', 'Order', {
          tag: 'FORM',
          kids: [
            el(21 + shift, 'textbox', 'Qty', { tag: 'INPUT' }),
            el(22 + shift, 'button', 'Place order', { tag: 'BUTTON' }),
          ],
        }),
        el(30 + shift, 'link', 'Next page', { tag: 'A', attrs: ['href', '/next'] }),
      ],
    }),
  };
}

const FIRST = shop(0, [
  [40, 'Apple'],
  [50, 'Banana'],
]);
const REPLACED = shop(1000, [
  [50, 'Banana'],
  [40, 'Apple'],
  [60, 'Cherry'],
]);

function read(refs: RefMap, page: FakeDocument): string[] {
  refs.useDocument(page.documentId);
  return outlineOf(axOf(page), { refs, sensitive: new Set() })!.lines;
}

function refOn(lines: string[], before: string, role: string): string {
  const at = lines.findIndex((line) => line.includes(before));
  const line = lines.slice(at).find((candidate) => candidate.includes(`- ${role}`))!;
  return /\[(ref_\d+)\]/.exec(line)![1]!;
}

function resolve(refs: RefMap, page: FakeDocument, ref: string, refindFor: RefindFor) {
  const document = { root: domOf(page), index: indexDocument(domOf(page)) };
  return resolveRef(
    fakeCdp(() => page),
    refs,
    ref,
    document,
    refindFor,
  );
}

describe('refs that stay on their element', () => {
  it('keeps a ref on its node across reads while the page adds and moves things', () => {
    const refs = new RefMap();
    const banana = refOn(read(refs, FIRST), 'Banana', 'button');
    const grown = shop(0, [
      [60, 'Cherry'],
      [50, 'Banana'],
      [40, 'Apple'],
    ]);
    expect(refOn(read(refs, grown), 'Banana', 'button')).toBe(banana);
    expect(refs.nodeFor(banana)).toBe(52);
  });

  it('acts on the same node with no lookup while it is still in the document', async () => {
    const refs = new RefMap();
    const apple = refOn(read(refs, FIRST), 'Apple', 'button');
    await expect(resolve(refs, FIRST, apple, 'click')).resolves.toEqual({
      node: 42,
      refound: false,
    });
  });
});

describe('a page that replaced its elements', () => {
  it('finds a replaced button again when exactly one element matches', async () => {
    const refs = new RefMap();
    const banana = refOn(read(refs, FIRST), 'Banana', 'button');
    await expect(resolve(refs, REPLACED, banana, 'click')).resolves.toEqual({
      node: 1052,
      refound: true,
    });
    await expect(resolve(refs, REPLACED, banana, null)).resolves.toEqual({
      node: 1052,
      refound: false,
    });
    expect(refOn(read(refs, REPLACED), 'Banana', 'button')).toBe(banana);
  });

  it('does not guess when two elements match', async () => {
    const refs = new RefMap();
    const banana = refOn(read(refs, FIRST), 'Banana', 'button');
    const twice = shop(1000, [
      [50, 'Banana'],
      [70, 'Banana'],
    ]);
    await expect(resolve(refs, twice, banana, 'click')).rejects.toThrow(/is gone.*Read the page/);
  });

  it('never looks again for a submit button, a link or a key press in a form', async () => {
    const refs = new RefMap();
    const lines = read(refs, FIRST);
    const order = refOn(lines, 'Order', 'button');
    const next = refOn(lines, 'Next page', 'link');
    const qty = refOn(lines, 'Order', 'textbox');
    const refused = /does not look again for a link, a submit button or anything in a form/;
    await expect(resolve(refs, REPLACED, order, 'click')).rejects.toThrow(refused);
    await expect(resolve(refs, REPLACED, next, 'click')).rejects.toThrow(refused);
    await expect(resolve(refs, REPLACED, qty, 'key')).rejects.toThrow(refused);
    await expect(resolve(refs, REPLACED, qty, 'type')).resolves.toEqual({
      node: 1021,
      refound: true,
    });
  });

  it('does not look again when the action was already checked against another element', async () => {
    const refs = new RefMap();
    const apple = refOn(read(refs, FIRST), 'Apple', 'button');
    await expect(resolve(refs, REPLACED, apple, null)).rejects.toThrow(/is gone/);
  });

  it('does not look again for a ref read before the page changed its address in place', async () => {
    const refs = new RefMap();
    const apple = refOn(read(refs, FIRST), 'Apple', 'button');
    refs.movedInPage();
    await expect(resolve(refs, REPLACED, apple, 'click')).rejects.toThrow(/is gone/);
  });
});

describe('the page epoch', () => {
  it('rejects a ref from the document before a navigation', async () => {
    const refs = new RefMap();
    const apple = refOn(read(refs, FIRST), 'Apple', 'button');
    refs.clear();
    await expect(resolve(refs, FIRST, apple, 'click')).rejects.toThrow(/from an earlier page/);
  });

  it('starts a new epoch when the tab shows a new document without a navigation event', async () => {
    const refs = new RefMap();
    const apple = refOn(read(refs, FIRST), 'Apple', 'button');
    const epoch = refs.epoch;
    const rewritten = { ...FIRST, documentId: 9001 };
    await expect(resolve(refs, rewritten, apple, 'click')).rejects.toThrow(/from an earlier page/);
    expect(refs.epoch).toBe(epoch + 1);
  });

  it('never takes a ref from another tab for one of its own', async () => {
    const numbers = new RefNumbers();
    const first = new RefMap(numbers);
    const second = new RefMap(numbers);
    const apple = refOn(read(first, FIRST), 'Apple', 'button');
    read(second, REPLACED);
    expect(second.nodeFor(apple)).toBeNull();
    await expect(resolve(second, REPLACED, 'ref_9999', 'click')).rejects.toThrow(
      /not a ref on this tab's page/,
    );
  });
});
