import {
  browserPipResultSchema,
  nextBrowserZoom,
  type BrowserCommand,
  type BrowserPipResult,
} from '@spark-outpost/contracts';
import type { Cdp } from './cdp.ts';
import type { BrowserPanes } from './panes.ts';
import type { PaneTab } from './tab.ts';

export type TabBasicCommand = Extract<
  BrowserCommand,
  { command: 'mute' | 'zoom' | 'move' | 'print' | 'pip' }
>;

const BASICS: ReadonlySet<string> = new Set(['mute', 'zoom', 'move', 'print', 'pip']);
const REFUSED: BrowserPipResult = { pip: 'refused' };

export function isTabBasic(action: BrowserCommand): action is TabBasicCommand {
  return BASICS.has(action.command);
}

export const PIP_TOGGLE = `(async () => {
  if (document.pictureInPictureElement) {
    await document.exitPictureInPicture();
    return 'left';
  }
  if (!document.pictureInPictureEnabled) return 'refused';
  const area = (video) => video.clientWidth * video.clientHeight;
  const playing = Array.from(document.querySelectorAll('video'))
    .filter((video) => !video.paused && !video.ended && video.readyState > 0)
    .sort((a, b) => area(b) - area(a));
  const video = playing.find((candidate) => !candidate.disablePictureInPicture);
  if (!video) return playing.length > 0 ? 'refused' : 'no_video';
  await video.requestPictureInPicture();
  return 'entered';
})()`;

export async function togglePip(cdp: Cdp): Promise<BrowserPipResult> {
  const { frameTree } = await cdp.send<{ frameTree: { frame: { id: string } } }>(
    'Page.getFrameTree',
  );
  const { executionContextId } = await cdp.send<{ executionContextId: number }>(
    'Page.createIsolatedWorld',
    { frameId: frameTree.frame.id, worldName: 'spark-pip' },
  );
  const { result } = await cdp.send<{ result: { value?: unknown } }>('Runtime.evaluate', {
    expression: PIP_TOGGLE,
    contextId: executionContextId,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  return browserPipResultSchema.safeParse({ pip: result.value }).data ?? REFUSED;
}

function zoom(panes: BrowserPanes, key: string, tab: PaneTab, step: 'in' | 'out' | 'reset'): void {
  const url = tab.currentUrl();
  const zooms = panes.pageZooms(key);
  if (!zooms) return;
  zooms.set(url, nextBrowserZoom(zooms.of(url), step));
  tab.media.syncZoom();
}

function print(panes: BrowserPanes, tab: PaneTab): void {
  tab.contents()?.print({}, (printed, reason) => {
    if (!printed && reason !== 'Print job canceled') {
      panes.logLine(`Could not print a browser tab: ${reason}`);
    }
  });
}

export async function runTabBasic(
  panes: BrowserPanes,
  key: string,
  tab: PaneTab,
  action: TabBasicCommand,
): Promise<BrowserPipResult | undefined> {
  if (action.command === 'move') {
    panes.move(key, tab.id, action.before);
    return undefined;
  }
  tab.keep();
  if (action.command === 'mute') tab.media.setMuted(action.muted);
  else if (action.command === 'zoom') zoom(panes, key, tab, action.step);
  else if (tab.agentBusy > 0) return action.command === 'pip' ? REFUSED : undefined;
  else if (action.command === 'print') print(panes, tab);
  else {
    const { cdp } = await tab.wake();
    return togglePip(cdp).catch(() => REFUSED);
  }
  return undefined;
}
