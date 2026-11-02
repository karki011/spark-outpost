import {
  BROWSER_PAGE_TEXT_MAX,
  classifyBrowserUrl,
  redactText,
  type BrowserPageText,
  type BrowserProfile,
} from '@spark-outpost/contracts';
import { readPage } from './page-read.ts';
import type { BrowserPanes } from './panes.ts';

export async function readViewPageText(
  panes: BrowserPanes,
  profile: BrowserProfile,
  tabId: string,
): Promise<BrowserPageText> {
  const tab = panes.tab(profile, tabId);
  const url = tab?.currentUrl() ?? 'about:blank';
  const kind = classifyBrowserUrl(url);
  if (!tab || (kind !== 'local' && kind !== 'external')) {
    throw new Error('That tab has no page to read.');
  }
  const { cdp } = await tab.wake();
  const page = await readPage(
    cdp,
    tab.refs,
    { mode: 'text', scope: 'main', offset: 0, maxChars: BROWSER_PAGE_TEXT_MAX },
    tab.filled,
  );
  return {
    url: tab.currentUrl().slice(0, 4096),
    title: redactText(tab.currentTitle()).slice(0, 300),
    text: redactText(page.text).slice(0, BROWSER_PAGE_TEXT_MAX),
    main: page.main !== 'whole_page',
  };
}
