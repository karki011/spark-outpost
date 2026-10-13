import {
  browserActLine,
  browserOrigin,
  browserPlaceOf,
  type BrowserHostErrorCode,
  type BrowserHostRequest,
  type BrowserTab,
} from '@spark-outpost/contracts';
import { describeTarget } from './act-target.ts';
import { actOnPage } from './agent-act.ts';
import { PageToolError, boxOf, readPage } from './page-read.ts';
import { capturePage } from './page-tools.ts';
import type { BrowserPanes } from './panes.ts';
import { agentOpenProblem } from './request-guard.ts';
import { SignInError, signInOnPage } from './sign-in.ts';
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
  const home = {
    projectId: request.projectId,
    keepSignIns: request.keepSignIns,
    roots: request.roots,
  };
  panes.touch(request.chatId, home);
  const problem = agentOpenProblem(request.url, panes.guardFacts(request.chatId));
  if (problem) throw new BrowserOpError('not_allowed', problem);
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
    const page = await readPage(cdp, tab.refs, request, tab.filled);
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
    const shot = await capturePage(cdp, {
      box,
      fullPage: request.fullPage,
      filled: tab.filled,
    });
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

async function signIn(panes: BrowserPanes, request: Request<'sign_in'>, signal: AbortSignal) {
  const tab = targetTab(panes, request.chatId, request.tab);
  return panes.whileDriving(tab, async () => {
    const { cdp } = await tab.wake();
    const { origin, username, password } = request;
    const done = await signInOnPage(
      cdp,
      { origin, username, password },
      { signal, filled: (node) => tab.filled.add(node) },
    );
    return { ...tabFacts(tab), url: done.url.slice(0, 4096), steps: done.steps };
  });
}

function nodeOf(tab: PaneTab, ref: string | undefined): number | null {
  if (ref === undefined) return null;
  const node = tab.refs.nodeFor(ref);
  if (node === null) {
    throw new BrowserOpError('no_ref', `${ref} is not on this page any more. Read it again.`);
  }
  return node;
}

async function page(panes: BrowserPanes, request: Request<'page'>) {
  const tab = targetTab(panes, request.chatId, request.tab);
  const node = nodeOf(tab, request.ref);
  if (node === null) return tabFacts(tab);
  const { cdp } = await tab.wake();
  const target = await describeTarget(cdp, node, tab.filled);
  return { ...tabFacts(tab), target };
}

async function act(panes: BrowserPanes, request: Request<'act'>, signal: AbortSignal) {
  const tab = targetTab(panes, request.chatId, request.tab);
  const from = tab.currentUrl();
  if ((browserOrigin(from) ?? 'about:blank') !== request.origin) {
    throw new BrowserOpError(
      'page_changed',
      'The tab moved to another site since it was checked. Read the page again.',
    );
  }
  return panes.whileDriving(tab, async () => {
    const { cdp } = await tab.wake();
    const { action, key, direction } = request;
    const target = await actOnPage(
      cdp,
      { action, node: nodeOf(tab, request.ref), text: request.text, key, direction },
      { filled: tab.filled, history: (step) => tab.history(step), signal },
    );
    const did = browserActLine({ action, target, key, direction });
    tab.lastAction = did;
    panes.noteChange(tab.chatId);
    return { ...tabFacts(tab), action, target, from: from.slice(0, 4096), did };
  });
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
    if (request.op === 'page') return await page(panes, request);
    if (request.op === 'act') return await act(panes, request, signal);
    if (request.op === 'sign_in') return await signIn(panes, request, signal);
    return {
      closed: request.runId ? panes.closeRunTabs(request.chatId, request.runId) : 0,
    };
  } catch (error) {
    if (error instanceof BrowserOpError) throw error;
    if (error instanceof PageToolError) throw new BrowserOpError(error.code, error.message);
    if (error instanceof SignInError) throw new BrowserOpError(error.code, error.message);
    if (request.op === 'sign_in') {
      throw new BrowserOpError('failed', 'Spark could not sign in on this page.');
    }
    throw new BrowserOpError('failed', (error as Error).message.slice(0, 300));
  }
}
