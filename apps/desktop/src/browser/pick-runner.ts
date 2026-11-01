import type { BrowserWindow } from 'electron';
import type { BrowserPick } from '@spark-outpost/contracts';
import type { BrowserPanes } from './panes.ts';
import { openPickOverlay } from './pick-overlay.ts';
import { startPick, type PickSession } from './pick-session.ts';
import type { PaneTab } from './tab.ts';

export interface PickRunnerOptions {
  panes(): BrowserPanes;
  window(): BrowserWindow | null;
  picked(pick: BrowserPick): void;
  keepsImage(tab: PaneTab): boolean;
}

export interface PickRunner {
  pick(tab: PaneTab, mode: 'element' | 'region' | 'off'): Promise<void>;
  stop(tab: PaneTab): Promise<void>;
}

export function pickRunner(options: PickRunnerOptions): PickRunner {
  const picks = new Map<string, PickSession>();

  const stop = async (tab: PaneTab) => {
    const session = picks.get(tab.id);
    picks.delete(tab.id);
    tab.picking = false;
    await session?.cancel();
    options.panes().noteChange(tab.chatId);
  };

  const pick = async (tab: PaneTab, mode: 'element' | 'region' | 'off') => {
    await stop(tab);
    if (mode === 'off') return;
    const window = options.window();
    if (!window) return;
    const panes = options.panes();
    const { cdp, view } = await tab.wake();
    const { view: overlay, surface } = await openPickOverlay(window, view, view.getBounds());
    tab.pickOverlay = overlay;
    tab.picking = true;
    panes.noteChange(tab.chatId);
    panes.layout();
    overlay.webContents.focus();
    const session = await startPick(
      cdp,
      surface,
      mode,
      {
        picked: (facts) => {
          options.picked({
            chatId: tab.chatId,
            url: tab.currentUrl().slice(0, 4096),
            title: tab.currentTitle().slice(0, 300),
            ...facts,
            image: options.keepsImage(tab) ? facts.image : null,
          });
        },
        ended: () => {
          picks.delete(tab.id);
          tab.pickOverlay = null;
          tab.picking = false;
          panes.noteChange(tab.chatId);
          options.window()?.webContents.focus();
        },
      },
      tab.filled,
    );
    picks.set(tab.id, session);
  };

  return { pick, stop };
}
