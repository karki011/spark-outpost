import type { BrowserBounds } from '@spark-outpost/contracts';
import type { PaneTab } from './tab.ts';

export const DEVTOOLS_SHARE = 0.45;
export const DEVTOOLS_GAP = 1;
const PAGE_MIN = 80;

export interface DockedBounds {
  page: BrowserBounds;
  devtools: BrowserBounds;
}

export function dockDevtools(bounds: BrowserBounds): DockedBounds {
  const room = Math.max(0, bounds.height - DEVTOOLS_GAP);
  const page = Math.min(room, Math.max(PAGE_MIN, Math.round(room * (1 - DEVTOOLS_SHARE))));
  const top = bounds.y + page + DEVTOOLS_GAP;
  return {
    page: { ...bounds, height: page },
    devtools: { ...bounds, y: top, height: Math.max(0, bounds.y + bounds.height - top) },
  };
}

export function showTab(
  tab: PaneTab,
  bounds: BrowserBounds | null,
  zoomed: (bounds: BrowserBounds) => BrowserBounds,
): void {
  const view = tab.view();
  if (!view) return;
  const tools = tab.devtoolsView();
  const visible =
    bounds !== null && bounds.width > 0 && bounds.height > 0 && tab.currentUrl() !== 'about:blank';
  if (visible) {
    const docked = tools ? dockDevtools(bounds) : null;
    const page = zoomed(docked ? docked.page : bounds);
    view.setBounds(page);
    tab.pickOverlay?.setBounds(page);
    if (docked) tools?.setBounds(zoomed(docked.devtools));
  }
  if (visible && !tab.shown) tab.media.syncZoom();
  view.setVisible(visible);
  tab.pickOverlay?.setVisible(visible);
  tools?.setVisible(visible && tools.getBounds().height > 0);
  tab.shown = visible;
}
