import type { Locator } from '@playwright/test';

export interface MenuFit {
  sideways: number;
  outsideWindow: boolean;
  outsideComposer: boolean;
  overlaps: string[];
  spills: string[];
}

export function menuFit(menu: Locator, rows: string, parts: string[] = []): Promise<MenuFit> {
  return menu.evaluate(
    (panel, { rowSelector, partSelectors }) => {
      const apart = (a: DOMRect, b: DOMRect) =>
        b.left >= a.right - 0.5 ||
        b.right <= a.left + 0.5 ||
        b.top >= a.bottom - 0.5 ||
        b.bottom <= a.top + 0.5;
      const box = panel.getBoundingClientRect();
      const composer = panel.closest('.composer')?.getBoundingClientRect() ?? box;
      const overlaps: string[] = [];
      const spills: string[] = [];
      const scrollers = [panel, ...panel.querySelectorAll<HTMLElement>('*')].filter((node) =>
        ['auto', 'scroll'].includes(getComputedStyle(node).overflowX),
      );
      const sideways = Math.max(0, ...scrollers.map((node) => node.scrollWidth - node.clientWidth));
      panel.querySelectorAll<HTMLElement>(rowSelector).forEach((row, index) => {
        const frame = row.getBoundingClientRect();
        const picked =
          partSelectors.length > 0
            ? partSelectors.map((selector) => ({
                selector,
                node: row.querySelector<HTMLElement>(selector),
              }))
            : [...row.children].map((node, at) => ({
                selector: `${node.tagName.toLowerCase()}:${at}`,
                node: node as HTMLElement,
              }));
        const shown = picked
          .filter(({ node }) => node && node.getBoundingClientRect().width > 0)
          .map(({ selector, node }) => ({ selector, rect: node!.getBoundingClientRect() }));
        for (const part of row.children) {
          if (getComputedStyle(part).overflowX !== 'visible') continue;
          const outer = part.getBoundingClientRect();
          for (const inner of part.querySelectorAll('*')) {
            const rect = inner.getBoundingClientRect();
            if (rect.width === 0) continue;
            if (rect.left < outer.left - 0.5 || rect.right > outer.right + 0.5) {
              spills.push(`row ${index}: ${inner.tagName.toLowerCase()} leaves its part`);
            }
          }
        }
        shown.forEach(({ selector, rect }, at) => {
          if (rect.left < frame.left - 0.5 || rect.right > frame.right + 0.5) {
            spills.push(`row ${index}: ${selector}`);
          }
          for (const other of shown.slice(at + 1)) {
            if (!apart(rect, other.rect)) {
              overlaps.push(`row ${index}: ${selector} / ${other.selector}`);
            }
          }
        });
      });
      return {
        sideways,
        outsideWindow: box.left < -0.5 || box.right > document.documentElement.clientWidth + 0.5,
        outsideComposer: box.left < composer.left - 0.5 || box.right > composer.right + 0.5,
        overlaps,
        spills,
      };
    },
    { rowSelector: rows, partSelectors: parts },
  );
}

export const FITS: MenuFit = {
  sideways: 0,
  outsideWindow: false,
  outsideComposer: false,
  overlaps: [],
  spills: [],
};
