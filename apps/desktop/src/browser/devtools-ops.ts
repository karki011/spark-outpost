import { browserOrigin, type BrowserHostRequest } from '@spark-outpost/contracts';
import { evaluateInPage } from './devtools-eval.ts';
import { inspectElement } from './devtools-inspect.ts';
import { pagePerformance, pageStorage } from './devtools-page.ts';
import { BrowserOpError, tabFacts, targetTab } from './op-tab.ts';
import type { BrowserPanes } from './panes.ts';

type DevtoolsOp = 'evaluate' | 'inspect' | 'performance' | 'storage';
type Request<Op extends DevtoolsOp> = Extract<BrowserHostRequest, { op: Op }>;

const MOVED = 'The tab moved to another site since it was checked. Read the page again.';

async function evaluate(panes: BrowserPanes, request: Request<'evaluate'>) {
  const tab = targetTab(panes, request.chatId, request.tab);
  const url = tab.currentUrl();
  if ((browserOrigin(url) ?? 'about:blank') !== request.origin) {
    throw new BrowserOpError('page_changed', MOVED);
  }
  return panes.whileDriving(tab, async () => {
    const { cdp } = await tab.wake();
    const outcome = await evaluateInPage(cdp, request.expression, tab.filled, url);
    tab.lastAction = 'Ran a script in the page';
    panes.noteChange(tab.chatId);
    return { ...tabFacts(tab), ...outcome };
  });
}

async function inspect(panes: BrowserPanes, request: Request<'inspect'>) {
  const tab = targetTab(panes, request.chatId, request.tab);
  const { cdp } = await tab.wake();
  const found = await inspectElement(cdp, tab.refs, request, tab.filled);
  return { ...tabFacts(tab), ...found };
}

async function performance(panes: BrowserPanes, request: Request<'performance'>) {
  const tab = targetTab(panes, request.chatId, request.tab);
  const { cdp } = await tab.wake();
  return { ...tabFacts(tab), ...(await pagePerformance(cdp)) };
}

async function storage(panes: BrowserPanes, request: Request<'storage'>) {
  const tab = targetTab(panes, request.chatId, request.tab);
  const { cdp } = await tab.wake();
  const url = tab.currentUrl();
  const origin = browserOrigin(url);
  if (origin === null || origin === 'file://') {
    throw new BrowserOpError('failed', 'This tab has no web storage to show.');
  }
  const values = request.values && tab.owner === 'agent';
  return {
    ...tabFacts(tab),
    valuesShown: values,
    ...(await pageStorage(cdp, url, origin, values)),
  };
}

export function isDevtoolsOp(request: BrowserHostRequest): request is Request<DevtoolsOp> {
  return (
    request.op === 'evaluate' ||
    request.op === 'inspect' ||
    request.op === 'performance' ||
    request.op === 'storage'
  );
}

export function runDevtoolsOp(panes: BrowserPanes, request: Request<DevtoolsOp>): Promise<unknown> {
  if (request.op === 'evaluate') return evaluate(panes, request);
  if (request.op === 'inspect') return inspect(panes, request);
  if (request.op === 'performance') return performance(panes, request);
  return storage(panes, request);
}
