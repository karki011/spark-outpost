// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createAnchor, locateAnchor, resolveAnchor } from './anchor.ts';

function message(html: string): Element {
  const root = document.createElement('div');
  root.className = 'md';
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

function rangeOf(root: Element, needle: string, occurrence = 0): Range {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.nodeValue!.indexOf(needle);
    if (at === -1) continue;
    if (seen++ < occurrence) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + needle.length);
    return range;
  }
  throw new Error(`No ${needle}`);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('text anchors', () => {
  it('records the quote with its surrounding text and offsets', () => {
    const root = message('<p>Build it.</p><p>Then <b>ship</b> it.</p>');
    const anchor = createAnchor(root, rangeOf(root, 'ship'));
    expect(anchor).toEqual({
      exact: 'ship',
      prefix: 'Build it.Then ',
      suffix: ' it.',
      start: 14,
      end: 18,
    });
  });

  it('finds the passage again after the message re-renders into new nodes', () => {
    const before = message('<p>Build it.</p><p>Then <b>ship</b> it today.</p>');
    const anchor = createAnchor(before, rangeOf(before, 'ship'));
    before.remove();
    const after = message('<p>Build it.</p><p>Then <em>sh</em>ip it today.</p>');

    const range = resolveAnchor([after], anchor);
    expect(range?.toString()).toBe('ship');
    expect(range?.startContainer.parentElement?.tagName).toBe('EM');
  });

  it('tells repeated text apart by its context', () => {
    const root = message('<p>Run it now. Then run it later.</p>');
    const anchor = createAnchor(root, rangeOf(root, 'run it'));
    const moved = { ...anchor, start: 0, end: 6 };
    expect(locateAnchor(root.textContent!, moved)?.start).toBe(17);
  });

  it('picks the best match across several message blocks', () => {
    const first = message('<p>Alpha beta</p>');
    const second = message('<p>Gamma beta delta</p>');
    const anchor = createAnchor(second, rangeOf(second, 'beta'));
    const range = resolveAnchor([first, second], anchor);
    expect(range?.startContainer.parentElement?.closest('.md')).toBe(second);
  });

  it('gives up when the passage is gone', () => {
    const root = message('<p>Something else</p>');
    expect(
      resolveAnchor([root], { exact: 'ship', prefix: '', suffix: '', start: 0, end: 4 }),
    ).toBeNull();
  });
});
