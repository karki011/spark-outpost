import {
  browserPlaceOf,
  classifyBrowserUrl,
  type BrowserHostErrorCode,
  type BrowserHostRequest,
  type BrowserTab,
} from '@spark-outpost/contracts';
import { fileURLToPath } from 'node:url';
import { PageToolError, boxOf, capturePage, readPage } from './page-tools.ts';
import type { BrowserPanes } from './panes.ts';
import { insideRoots } from './request-guard.ts';
import type { PaneTab } from './tab.ts';
import { chooseOpenTab } from './tab-rules.ts';

export class BrowserOpError extends Error {
  readonly code: BrowserHostErrorCode;

  constructor(code: BrowserHostErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

type Request<Op extends BrowserHostRequest['op']> = Extract<BrowserHostRequest, { op: Op }>;

function tabFacts(tab: PaneTab) {
  const url = tab.currentUrl();
  return {
    tabId: tab.id,
    url: url.slice(0, 4096),
    title: tab.currentTitle().slice(0, 300),
    place: browserPlaceOf(url),
    owner: tab.owner,
  };
}

function agentMayOpen(url: string, roots: readonly string[]): boolean {
  const kind = classifyBrowserUrl(url);
  if (kind === 'local') return true;
  if (kind !== 'file') return false;
  try {
    return insideRoots(fileURLToPath(url), roots);
  } catch {
    return false;
  }
}

function targetTab(panes: BrowserPanes, chatId: string, wanted: string | undefined): PaneTab {
  const tabs = panes.tabsOf(chatId);
  const tab = wanted
    ? tabs.find((candidate) => candidate.id === wanted)
    : (tabs
        .filter((candidate) => candidate.owner === 'agent')
        .sort((a, b) => b.lastUsed - a.lastUsed)[0] ?? tabs.find((candidate) => candidate.active));
  if (!tab) {
    throw new BrowserOpError(
      'no_tab',
      wanted ? `There is no tab ${wanted} in this chat.` : 'No tab is open in this chat yet.',
    );
  }
  if (tab.picking) {
    throw new BrowserOpError('user_picking', 'The user is selecting on this tab. Try again soon.');
  }
  return tab;
}

async function open(panes: BrowserPanes, request: Request<'open'>, signal: AbortSignal) {
  if (!agentMayOpen(request.url, request.roots)) {
    throw new BrowserOpError('not_allowed', 'Agents can open local pages and project files only.');
  }
  const home = {
    projectId: request.projectId,
    keepSignIns: request.keepSignIns,
    roots: request.roots,
  };
  panes.touch(request.chatId, home);
  const tabs = panes.tabsOf(request.chatId);
  const choice = chooseOpenTab(
    tabs.map((tab) => tab.facts()),
    request.url,
    request.tab,
  );
  if (choice.action === 'limit') {
    throw new BrowserOpError('tab_limit', 'This chat has too many tabs. Close or unpin one.');
  }
  const tab =
    choice.action === 'new'
      ? panes.createTab(request.chatId, {
          owner: 'agent',
          runId: request.runId,
          url: 'about:blank',
        })
      : panes.tab(request.chatId, choice.tabId);
  if (!tab) throw new BrowserOpError('tab_limit', 'This chat has too many tabs.');
  if (tab.picking) {
    throw new BrowserOpError('user_picking', 'The user is selecting on this tab. Try again soon.');
  }
  if (tab.owner === 'agent') tab.runId = request.runId;
  return panes.whileDriving(tab, async () => {
    if (choice.action === 'reuse') await tab.wake();
    else await tab.load(request.url, signal);
    const userIsElsewhere = tabs.some((other) => other.active && other.owner === 'user');
    if (!userIsElsewhere) panes.select(request.chatId, tab.id);
    panes.layout();
    if (tab.error) throw new BrowserOpError('load_failed', `The page did not load: ${tab.error}`);
    const reused = choice.action === 'reuse' || choice.action === 'reload';
    return { ...tabFacts(tab), status: tab.status, reused };
  });
}

function listTabs(panes: BrowserPanes, request: Request<'tabs'>): { tabs: BrowserTab[] } {
  return {
    tabs: panes.tabsOf(request.chatId).map((tab) => {
      const { id, title, url, owner, active, place } = tab.paneTab();
      return { id, title, url, owner, active, place };
    }),
  };
}

async function read(panes: BrowserPanes, request: Request<'read'>) {
  const tab = targetTab(panes, request.chatId, request.tab);
  return panes.whileDriving(tab, async () => {
    const { cdp } = await tab.wake();
    const page = await readPage(cdp, tab.refs, request);
    return { ...tabFacts(tab), mode: request.mode, ...page };
  });
}

async function screenshot(panes: BrowserPanes, request: Request<'screenshot'>) {
  const tab = targetTab(panes, request.chatId, request.tab);
  return panes.whileDriving(tab, async () => {
    const { cdp } = await tab.wake();
    const node = request.ref === undefined ? null : tab.refs.nodeFor(request.ref);
    if (request.ref !== undefined && node === null) {
      throw new BrowserOpError('no_ref', `${request.ref} is not on this page. Read it again.`);
    }
    const box = node === null ? null : await boxOf(cdp, node);
    if (node !== null && !box) {
      throw new BrowserOpError('no_ref', `${request.ref} is not visible on the page.`);
    }
    const shot = await capturePage(cdp, { box, fullPage: request.fullPage });
    return {
      ...tabFacts(tab),
      data: shot.data.toString('base64'),
      mediaType: shot.mediaType,
      width: shot.width,
      height: shot.height,
      masked: shot.masked,
    };
  });
}

async function logs(panes: BrowserPanes, request: Request<'logs'>) {
  const tab = targetTab(panes, request.chatId, request.tab);
  const live = await tab.wake();
  const log = request.kind === 'console' ? live.logs.console : live.logs.network;
  return {
    ...tabFacts(tab),
    kind: request.kind,
    entries: log.recent(request.filter, request.limit),
    dropped: log.dropped(),
  };
}

export async function runBrowserOp(
  panes: BrowserPanes,
  request: BrowserHostRequest,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    if (request.op === 'open') return await open(panes, request, signal);
    if (request.op === 'tabs') return listTabs(panes, request);
    if (request.op === 'read') return await read(panes, request);
    if (request.op === 'screenshot') return await screenshot(panes, request);
    if (request.op === 'logs') return await logs(panes, request);
    return {
      closed: request.runId ? panes.closeRunTabs(request.chatId, request.runId) : 0,
    };
  } catch (error) {
    if (error instanceof BrowserOpError) throw error;
    if (error instanceof PageToolError) throw new BrowserOpError(error.code, error.message);
    throw new BrowserOpError('failed', (error as Error).message.slice(0, 300));
  }
}
