import {
  classifyBrowserUrl,
  browserToViewSchema,
  type BrowserToView,
} from '@spark-outpost/contracts';
import type { BrowserPanes } from './panes.ts';
import type { BrowserViewHost } from './view-host.ts';

const BLANK = 'about:blank';
const IN_USE = 'This tab is in use. Try again when it is free.';

export type TransferResult = { ok: true } | { ok: false; reason: string };

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
