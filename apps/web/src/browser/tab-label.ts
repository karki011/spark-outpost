import { parseBrowserUrl, type BrowserPaneTab } from '@spark-outpost/contracts';

export function tabLabel(tab: Pick<BrowserPaneTab, 'title' | 'url'>): string {
  if (tab.title.trim() !== '') return tab.title;
  const url = parseBrowserUrl(tab.url);
  if (!url) return 'New tab';
  return url.host || url.pathname.split('/').pop() || 'New tab';
}
