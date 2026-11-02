import {
  browserActLine,
  browserOrigin,
  type BrowserHostRequest,
  type BrowserTab,
} from '@spark-outpost/contracts';
import { describeTarget } from './act-target.ts';
import { actOnPage } from './agent-act.ts';
import { PageToolError, boxOf, readPage } from './page-read.ts';
import { RefError, pageDocument, resolveRef, type RefindFor } from './ref-resolve.ts';
import { capturePage } from './page-tools.ts';
import { pageSettles } from './page-settle.ts';
import type { BrowserPanes } from './panes.ts';
import { agentOpenProblem } from './request-guard.ts';
import { SIGN_IN_TIMING, SignInError, signInOnPage } from './sign-in.ts';
import { textFieldNodes, type DomNode } from './sensitive-nodes.ts';
import { TabClosedError, type PaneTab } from './tab.ts';
import { BrowserOpError, refuseHeld, tabFacts, targetTab } from './op-tab.ts';
import { chooseOpenTab } from './tab-rules.ts';
import { isDevtoolsOp, runDevtoolsOp } from './devtools-ops.ts';

const DOWNLOAD_WAIT_MS = 50;
const DOWNLOAD_WAITS = 6;

async function downloadRefused(tab: PaneTab): Promise<boolean> {
  for (let wait = 0; wait < DOWNLOAD_WAITS && !tab.downloadRefused; wait += 1) {
    await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_WAIT_MS));
  }
  return tab.downloadRefused;
}

const DOWNLOAD_REFUSED =
  'That address is a download. Spark cancelled it: agents can’t download files, and only the user can save one.';

type Request<Op extends BrowserHostRequest['op']> = Extract<BrowserHostRequest, { op: Op }>;

export { BrowserOpError };

async function open(panes: BrowserPanes, request: Request<'open'>, signal: AbortSignal) {
  const home = { projectId: request.projectId, roots: request.roots };
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
  refuseHeld(tab);
  if (tab.owner === 'agent') tab.runId = request.runId;
  return panes.whileDriving(tab, async () => {
    if (choice.action === 'reuse') await tab.wake();
    else await tab.load(request.url, signal);
    const userIsElsewhere = tabs.some((other) => other.active && other.owner === 'user');
    if (!userIsElsewhere) panes.select(request.chatId, tab.id);
    panes.layout();
    if (tab.error && (await downloadRefused(tab))) {
      throw new BrowserOpError('load_failed', DOWNLOAD_REFUSED);
    }
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
    const node = (await boundNode(tab, request.ref, null))?.node ?? null;
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
  if (request.kind === 'network') {
    return {
      ...tabFacts(tab),
      kind: request.kind,
      entries: [],
      requests: live.logs.network.all(),
      dropped: live.logs.network.dropped(),
    };
  }
  return {
    ...tabFacts(tab),
    kind: request.kind,
    entries: live.logs.console.recent(request.filter, request.limit),
    requests: [],
    dropped: live.logs.console.dropped(),
  };
}

async function signIn(panes: BrowserPanes, request: Request<'sign_in'>, signal: AbortSignal) {
  const tab = targetTab(panes, request.chatId, request.tab);
  return panes.whileDriving(tab, async () => {
    const { cdp } = await tab.wake();
    const { sites, username, password } = request;
    const done = await signInOnPage(
      cdp,
      { sites, username, password },
      { signal, filled: (node) => tab.filled.add(node) },
    );
    return { ...tabFacts(tab), url: done.url.slice(0, 4096), steps: done.steps };
  });
}

async function boundNode(tab: PaneTab, ref: string | undefined, refindFor: RefindFor) {
  if (ref === undefined) return null;
  const { cdp } = await tab.wake();
  return resolveRef(cdp, tab.refs, ref, await pageDocument(cdp), refindFor);
}

const MOVED = 'The element changed since it was checked, so nothing was done. Read the page again.';

async function page(panes: BrowserPanes, request: Request<'page'>, signal: AbortSignal) {
  const tab = targetTab(panes, request.chatId, request.tab);
  if (request.settle) {
    const { cdp } = await tab.wake();
    await pageSettles(cdp, SIGN_IN_TIMING, signal);
  }
  const bound = await boundNode(tab, request.ref, request.action ?? null);
  if (bound === null) return tabFacts(tab);
  const { cdp } = await tab.wake();
  const target = await describeTarget(cdp, bound.node, tab.filled);
  return {
    ...tabFacts(tab),
    target,
    node: bound.node,
    epoch: tab.refs.epoch,
    ...(bound.refound ? { refound: true } : {}),
  };
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
    const node = (await boundNode(tab, request.ref, null))?.node ?? null;
    const moved = request.epoch !== undefined && request.epoch !== tab.refs.epoch;
    if (moved || (request.node !== undefined && request.node !== node)) {
      throw new BrowserOpError('page_changed', MOVED);
    }
    const target = await actOnPage(
      cdp,
      {
        action,
        node,
        ref: request.ref,
        text: request.text,
        key,
        direction,
      },
      { filled: tab.filled, history: (step) => tab.history(step), signal },
    );
    const did = browserActLine({ action, target, key, direction });
    tab.lastAction = did;
    panes.noteChange(tab.chatId);
    return { ...tabFacts(tab), action, target, from: from.slice(0, 4096), did };
  });
}

function keep(panes: BrowserPanes, request: Request<'keep'>) {
  const tab = panes.tab(request.chatId, request.tab);
  tab?.keep();
  return { kept: tab?.kept ?? false };
}

const NOT_YOUR_TAB =
  'Hand over only a tab you opened; this tab is the user’s. Open the sign-in page in your own tab first.';

async function handOver(panes: BrowserPanes, request: Request<'hand_over'>) {
  const tab = panes.tab(request.chatId, request.tab);
  if (!tab) throw new BrowserOpError('no_tab', `There is no tab ${request.tab} in this chat.`);
  if (!request.handoff) {
    const masked = await releaseHandoff(tab);
    panes.noteChange(request.chatId);
    return { ...tabFacts(tab), masked };
  }
  if (tab.owner !== 'agent') throw new BrowserOpError('not_allowed', NOT_YOUR_TAB);
  tab.handoff = request.handoff;
  tab.handoffRun = request.runId;
  tab.keep();
  panes.select(request.chatId, tab.id);
  panes.noteChange(request.chatId);
  return { ...tabFacts(tab), masked: 0 };
}

async function releaseHandoff(tab: PaneTab): Promise<number> {
  tab.handoff = null;
  tab.handoffRun = null;
  tab.forgetLogs();
  const { cdp } = await tab.wake();
  const fields = await cdp
    .send<{ root: DomNode }>('DOM.getDocument', { depth: -1, pierce: true })
    .then(({ root }) => textFieldNodes(root))
    .catch((): number[] => []);
  for (const node of fields) tab.filled.add(node);
  return fields.length;
}

async function endRun(panes: BrowserPanes, request: Request<'end_run'>) {
  if (!request.runId) return { closed: 0 };
  const held = panes.tabsOf(request.chatId).filter((tab) => tab.handoffRun === request.runId);
  for (const tab of held) await releaseHandoff(tab).catch(() => 0);
  return { closed: panes.closeRunTabs(request.chatId, request.runId) };
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
    if (request.op === 'page') return await page(panes, request, signal);
    if (request.op === 'keep') return keep(panes, request);
    if (request.op === 'hand_over') return await handOver(panes, request);
    if (isDevtoolsOp(request)) return await runDevtoolsOp(panes, request);
    if (request.op === 'act') return await act(panes, request, signal);
    if (request.op === 'sign_in') return await signIn(panes, request, signal);
    return await endRun(panes, request);
  } catch (error) {
    if (error instanceof BrowserOpError) throw error;
    if (error instanceof TabClosedError) throw new BrowserOpError('no_tab', error.message);
    if (error instanceof PageToolError) throw new BrowserOpError(error.code, error.message);
    if (error instanceof RefError) throw new BrowserOpError('no_ref', error.message);
    if (error instanceof SignInError) throw new BrowserOpError(error.code, error.message);
    if (request.op === 'sign_in') {
      throw new BrowserOpError('failed', 'Spark could not sign in on this page.');
    }
    throw new BrowserOpError('failed', (error as Error).message.slice(0, 300));
  }
}
