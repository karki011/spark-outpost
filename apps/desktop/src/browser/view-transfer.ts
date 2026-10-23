import {
  BROWSER_TABS_MAX,
  classifyBrowserUrl,
  browserHandToChatSchema,
  browserToViewSchema,
  type BrowserHandToChat,
  type BrowserToView,
} from '@spark-outpost/contracts';
import type { BrowserPanes } from './panes.ts';
import type { BrowserViewHost } from './view-host.ts';

const BLANK = 'about:blank';
const IN_USE = 'This tab is in use. Try again when it is free.';

export type TransferResult = { ok: true } | { ok: false; reason: string };

export async function handToChat(
  chats: BrowserPanes,
  view: BrowserViewHost,
  raw: unknown,
): Promise<TransferResult> {
  const request: BrowserHandToChat = browserHandToChatSchema.parse(raw);
  const tab = view.panes.tab(request.profile, request.tabId);
  const url = tab?.currentUrl() ?? BLANK;
  if (!tab || url === BLANK) return { ok: false, reason: 'Open a page first.' };
  if (tab.handoff || tab.picking || tab.agentBusy > 0) return { ok: false, reason: IN_USE };
  if (chats.tabsOf(request.chatId).length >= BROWSER_TABS_MAX) {
    return { ok: false, reason: 'That chat has too many tabs. Close one there first.' };
  }
  const moved = chats.createTab(request.chatId, {
    owner: 'user',
    runId: null,
    url: BLANK,
    title: tab.currentTitle(),
  });
  if (!moved) return { ok: false, reason: 'That chat has too many tabs.' };
  chats.select(request.chatId, moved.id);
  try {
    await moved.load(url);
  } catch {
    chats.close(request.chatId, moved.id);
    return { ok: false, reason: 'The page didn’t open in that chat, so the tab stayed here.' };
  }
  if (request.profile === 'work') view.panes.close(request.profile, tab.id);
  return { ok: true };
}

export async function toView(
  chats: BrowserPanes,
  view: BrowserViewHost,
  raw: unknown,
): Promise<TransferResult> {
  const request: BrowserToView = browserToViewSchema.parse(raw);
  const tab = chats.tab(request.chatId, request.tabId);
  const url = tab?.currentUrl() ?? BLANK;
  if (!tab || url === BLANK) return { ok: false, reason: 'Open a page first.' };
  if (tab.handoff || tab.picking || tab.agentBusy > 0) return { ok: false, reason: IN_USE };
  const kind = classifyBrowserUrl(url);
  if (kind !== 'local' && kind !== 'external') {
    return { ok: false, reason: 'Only web pages open in the Browser view.' };
  }
  if (!(await view.openTab('work', url))) {
    return { ok: false, reason: 'The Browser view has too many Work tabs. Close one first.' };
  }
  chats.closeByUser(request.chatId, tab.id);
  return { ok: true };
}
