import type {
  BrowserActDirection,
  BrowserActKey,
  BrowserActKind,
  BrowserActTarget,
} from '@spark-outpost/contracts';
import { aimAt, mustBeSeen, stillClear, type AimContext, type Point } from './act-point.ts';
import { describeTarget } from './act-target.ts';
import type { Cdp } from './cdp.ts';
import { focusNode, pressKey, replaceFocusedText } from './page-input.ts';
import { PageToolError } from './page-read.ts';
import { pageSettles, type SettleTiming } from './page-settle.ts';

export interface ActRequest {
  action: BrowserActKind;
  node: number | null;
  ref?: string | undefined;
  text?: string | undefined;
  key?: BrowserActKey | undefined;
  direction?: BrowserActDirection | undefined;
}

export interface ActOptions {
  filled: ReadonlySet<number>;
  history(step: 'back' | 'forward' | 'reload'): boolean;
  signal: AbortSignal;
  timing?: SettleTiming;
  highlightMs?: number;
}

export const ACT_TIMING: SettleTiming = { settleMs: 700, loadMs: 8000, restMs: 300 };
export const ACT_SENSITIVE_FIELD =
  'That is a password, card or code field. Agents never type into those. For a saved test sign-in use spark_browser_signins and spark_browser_sign_in; otherwise ask the user to fill it.';
export const ACT_FOCUS_LOST =
  'The page did not let that element take the cursor. Nothing was typed.';

const HIGHLIGHT_MS = 900;
const SCROLL_SHARE = 0.8;
const HIGHLIGHT = {
  showInfo: false,
  contentColor: { r: 255, g: 170, b: 51, a: 0.35 },
  borderColor: { r: 255, g: 136, b: 0, a: 0.9 },
};
const SETTLING: ReadonlySet<BrowserActKind> = new Set([
  'click',
  'key',
  'back',
  'forward',
  'reload',
]);
const STEPS = { back: 'back', forward: 'forward', reload: 'reload' } as const;

async function highlight(cdp: Cdp, node: number, ms: number): Promise<void> {
  try {
    await cdp.send('DOM.enable');
    await cdp.send('Overlay.enable');
    await cdp.send('Overlay.highlightNode', { highlightConfig: HIGHLIGHT, backendNodeId: node });
  } catch {
    return;
  }
  const timer = setTimeout(() => {
    void cdp.send('Overlay.hideHighlight').catch(() => undefined);
  }, ms);
  timer.unref();
}

async function scrollTo(cdp: Cdp, node: number): Promise<void> {
  await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: node }).catch(() => undefined);
}

async function viewportCentre(cdp: Cdp): Promise<Point & { width: number; height: number }> {
  const { cssVisualViewport: view } = await cdp.send<{
    cssVisualViewport: { clientWidth: number; clientHeight: number };
  }>('Page.getLayoutMetrics');
  return {
    x: view.clientWidth / 2,
    y: view.clientHeight / 2,
    width: view.clientWidth,
    height: view.clientHeight,
  };
}

async function click(cdp: Cdp, node: number, aim: AimContext): Promise<void> {
  await scrollTo(cdp, node);
  const point = await aimAt(cdp, node, aim);
  const button = { ...point, button: 'left', clickCount: 1 };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await stillClear(cdp, node, point, aim);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...button });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...button });
}

async function focusSeen(cdp: Cdp, node: number, aim: AimContext): Promise<void> {
  await scrollTo(cdp, node);
  await mustBeSeen(cdp, node, aim);
  if (!(await focusNode(cdp, node))) throw new PageToolError('failed', ACT_FOCUS_LOST);
}

async function type(cdp: Cdp, node: number, text: string, aim: AimContext): Promise<void> {
  await focusSeen(cdp, node, aim);
  await replaceFocusedText(cdp, text);
}

async function scroll(
  cdp: Cdp,
  node: number | null,
  direction: BrowserActDirection,
  aim: AimContext,
): Promise<void> {
  const view = await viewportCentre(cdp);
  if (node !== null) await scrollTo(cdp, node);
  const point = node === null ? view : await aimAt(cdp, node, aim);
  const sign = direction === 'up' || direction === 'left' ? -1 : 1;
  const sideways = direction === 'left' || direction === 'right';
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: point.x,
    y: point.y,
    deltaX: sideways ? sign * view.width * SCROLL_SHARE : 0,
    deltaY: sideways ? 0 : sign * view.height * SCROLL_SHARE,
  });
}

async function perform(cdp: Cdp, request: ActRequest, options: ActOptions): Promise<void> {
  const { action, node } = request;
  const aim = { filled: options.filled, label: request.ref ?? 'That element' };
  if (action === 'click') return click(cdp, node!, aim);
  if (action === 'type') return type(cdp, node!, request.text ?? '', aim);
  if (action === 'scroll') return scroll(cdp, node, request.direction ?? 'down', aim);
  if (action === 'key') {
    if (node !== null) await focusSeen(cdp, node, aim);
    return pressKey(cdp, request.key ?? 'Enter');
  }
  if (!options.history(STEPS[action])) {
    throw new PageToolError('failed', `There is no page to go ${action} to.`);
  }
}

export async function actOnPage(
  cdp: Cdp,
  request: ActRequest,
  options: ActOptions,
): Promise<BrowserActTarget | null> {
  const { node } = request;
  if ((request.action === 'click' || request.action === 'type') && node === null) {
    throw new PageToolError('no_ref', `${request.action} needs a ref from a page read.`);
  }
  const target = node === null ? null : await describeTarget(cdp, node, options.filled);
  if (request.action === 'type' && target?.sensitive) {
    throw new PageToolError('sensitive_field', ACT_SENSITIVE_FIELD);
  }
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);
  if (node !== null) await highlight(cdp, node, options.highlightMs ?? HIGHLIGHT_MS);
  const settled = SETTLING.has(request.action)
    ? pageSettles(cdp, options.timing ?? ACT_TIMING, options.signal)
    : Promise.resolve();
  await perform(cdp, request, options);
  await settled;
  return target;
}
