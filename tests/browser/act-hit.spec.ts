import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { actOnPage } from '../../apps/desktop/src/browser/agent-act.ts';
import type { Cdp } from '../../apps/desktop/src/browser/cdp.ts';
import { cdpOf } from './playwright-cdp.ts';

const FIXTURES = path.resolve(import.meta.dirname, '../fixtures/browser-pane');
const SITE = 'http://shop.test';
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
};
const TIMING = { settleMs: 50, loadMs: 1000, restMs: 20 };

async function open(page: Page, name: string): Promise<Cdp> {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.route(`${SITE}/**`, async (route) => {
    const file = path.basename(new URL(route.request().url()).pathname);
    const body = await readFile(path.join(FIXTURES, file)).catch(() => null);
    if (!body) return route.fulfill({ status: 404, body: 'missing' });
    return route.fulfill({ body, contentType: TYPES[path.extname(file)] ?? 'text/plain' });
  });
  await page.goto(`${SITE}/${name}`);
  return cdpOf(await page.context().newCDPSession(page));
}

async function nodeAt(cdp: Cdp, selector: string, shadowHost?: string): Promise<number> {
  const { root } = await cdp.send<{ root: { nodeId: number } }>('DOM.getDocument', {
    depth: -1,
    pierce: true,
  });
  const scope = shadowHost ? await shadowRootOf(cdp, root.nodeId, shadowHost) : root.nodeId;
  const { nodeId } = await cdp.send<{ nodeId: number }>('DOM.querySelector', {
    nodeId: scope,
    selector,
  });
  const { node } = await cdp.send<{ node: { backendNodeId: number } }>('DOM.describeNode', {
    nodeId,
  });
  return node.backendNodeId;
}

async function shadowRootOf(cdp: Cdp, rootId: number, host: string): Promise<number> {
  const { nodeId } = await cdp.send<{ nodeId: number }>('DOM.querySelector', {
    nodeId: rootId,
    selector: host,
  });
  const { node } = await cdp.send<{ node: { shadowRoots: { nodeId: number }[] } }>(
    'DOM.describeNode',
    { nodeId, depth: 1, pierce: true },
  );
  return node.shadowRoots[0]!.nodeId;
}

function click(cdp: Cdp, node: number, ref: string) {
  return actOnPage(
    cdp,
    { action: 'click', node, ref },
    {
      filled: new Set(),
      history: () => true,
      signal: new AbortController().signal,
      timing: TIMING,
      highlightMs: 1,
    },
  );
}

test('a click on a button under a cookie banner names the banner and lands after it is closed', async ({
  page,
}) => {
  const cdp = await open(page, 'hit-banner.html');
  const buy = await nodeAt(cdp, '#buy');
  await expect(click(cdp, buy, 'ref_7')).rejects.toThrow(
    "ref_7 is covered by dialog 'Cookie consent'. Close or act on that first.",
  );
  await expect(page.getByRole('status')).toHaveText('Nothing clicked yet');
  await click(cdp, await nodeAt(cdp, '#accept'), 'ref_8');
  await expect(page.getByRole('status')).toHaveText('Cookies accepted');
  await click(cdp, buy, 'ref_7');
  await expect(page.getByRole('status')).toHaveText('Clicked Buy now');
});

test('a partly covered button is clicked where it is clear', async ({ page }) => {
  const cdp = await open(page, 'hit-banner.html');
  await click(cdp, await nodeAt(cdp, '#partial'), 'ref_2');
  await expect(page.getByRole('status')).toHaveText('Clicked Half hidden');
});

test('elements that take no clicks or cannot be seen are refused', async ({ page }) => {
  const cdp = await open(page, 'hit-banner.html');
  await expect(click(cdp, await nodeAt(cdp, '#ghost'), 'ref_3')).rejects.toThrow(
    'ref_3 does not take clicks (pointer-events: none).',
  );
  await expect(click(cdp, await nodeAt(cdp, '#invisible'), 'ref_4')).rejects.toThrow(
    'ref_4 is hidden or fully transparent',
  );
  await expect(page.getByRole('status')).toHaveText('Nothing clicked yet');
});

test('buttons inside open and closed shadow roots are clicked', async ({ page }) => {
  const cdp = await open(page, 'hit-banner.html');
  await click(cdp, await nodeAt(cdp, 'button', '#open-host'), 'ref_5');
  await expect(page.getByRole('status')).toHaveText('Clicked Shadow open');
  await click(cdp, await nodeAt(cdp, 'button', '#closed-host'), 'ref_6');
  await expect(page.getByRole('status')).toHaveText('Clicked Shadow closed');
});

test('a transparent overlay is refused even when the page fakes what is on top', async ({
  page,
}) => {
  const cdp = await open(page, 'hit-overlay.html');
  await expect(click(cdp, await nodeAt(cdp, '#send'), 'ref_1')).rejects.toThrow(
    "ref_1 is covered by link 'Approve transfer'. Close or act on that first.",
  );
  await expect(page.getByRole('status')).toHaveText('Nothing clicked yet');
});
