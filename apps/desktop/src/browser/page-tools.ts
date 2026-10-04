import { nativeImage, type NativeImage } from 'electron';
import {
  BROWSER_SCREENSHOT_WIDTH,
  type BrowserBox,
  type BrowserReadMode,
} from '@spark-outpost/contracts';
import type { Cdp } from './cdp.ts';
import { paintBoxes, quadBox, scaledBox } from './mask.ts';
import { outlineOf, pageOfLines, pageTextOf, type AxNode, type RefMap } from './outline.ts';
import { sensitiveNodes, type DomNode } from './sensitive-nodes.ts';

const FULL_PAGE_MAX_HEIGHT = 6000;
const PNG_MAX_BYTES = 3_500_000;
const JPEG_QUALITY = 82;

export class PageToolError extends Error {
  readonly code: 'no_ref' | 'failed';

  constructor(code: 'no_ref' | 'failed', message: string) {
    super(message);
    this.code = code;
  }
}

export async function sensitiveBackendIds(cdp: Cdp): Promise<number[]> {
  const { root } = await cdp.send<{ root: DomNode }>('DOM.getDocument', {
    depth: -1,
    pierce: true,
  });
  return sensitiveNodes(root);
}

function nodeForRef(refs: RefMap, ref: string | undefined): number | null {
  if (ref === undefined) return null;
  const node = refs.nodeFor(ref);
  if (node === null) {
    throw new PageToolError('no_ref', `${ref} is not on this page any more. Read the page again.`);
  }
  return node;
}

export interface ReadRequest {
  mode: BrowserReadMode;
  ref?: string | undefined;
  offset: number;
}

export async function readPage(cdp: Cdp, refs: RefMap, request: ReadRequest) {
  const rootBackendId = nodeForRef(refs, request.ref);
  const { nodes } = await cdp.send<{ nodes: AxNode[] }>('Accessibility.getFullAXTree');
  if (request.mode === 'text') {
    return { ...pageOfLines(pageTextOf(nodes, rootBackendId), request.offset), masked: 0 };
  }
  const sensitive = new Set(await sensitiveBackendIds(cdp));
  const outline = outlineOf(nodes, { refs, sensitive, rootBackendId });
  if (!outline) throw new PageToolError('no_ref', 'That part of the page is gone. Read it again.');
  return { ...pageOfLines(outline.lines, request.offset), masked: outline.masked };
}

export async function boxOf(cdp: Cdp, backendNodeId: number): Promise<BrowserBox | null> {
  try {
    const { model } = await cdp.send<{ model: { border: number[] } }>('DOM.getBoxModel', {
      backendNodeId,
    });
    return quadBox(model.border);
  } catch {
    return null;
  }
}

interface LayoutMetrics {
  cssVisualViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number };
  cssContentSize: { width: number; height: number };
}

export interface ShotRequest {
  box?: BrowserBox | null;
  fullPage?: boolean;
  maxWidth?: number;
}

export interface Shot {
  data: Buffer;
  mediaType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  masked: number;
}

async function sensitiveBoxes(cdp: Cdp): Promise<BrowserBox[]> {
  const boxes: BrowserBox[] = [];
  for (const backendNodeId of await sensitiveBackendIds(cdp)) {
    const box = await boxOf(cdp, backendNodeId);
    if (box && box.width > 0 && box.height > 0) boxes.push(box);
  }
  return boxes;
}

function overlaps(box: BrowserBox, clip: BrowserBox): boolean {
  return (
    box.x < clip.x + clip.width &&
    box.x + box.width > clip.x &&
    box.y < clip.y + clip.height &&
    box.y + box.height > clip.y
  );
}

function encoded(image: NativeImage): Pick<Shot, 'data' | 'mediaType'> {
  const png = image.toPNG();
  if (png.length <= PNG_MAX_BYTES) return { data: png, mediaType: 'image/png' };
  return { data: image.toJPEG(JPEG_QUALITY), mediaType: 'image/jpeg' };
}

export async function capturePage(cdp: Cdp, request: ShotRequest): Promise<Shot> {
  const metrics = await cdp.send<LayoutMetrics>('Page.getLayoutMetrics');
  const viewport = metrics.cssVisualViewport;
  const scroll = { x: viewport.pageX, y: viewport.pageY };
  const visible = { x: 0, y: 0, width: viewport.clientWidth, height: viewport.clientHeight };
  const whole = {
    x: -scroll.x,
    y: -scroll.y,
    width: metrics.cssContentSize.width,
    height: Math.min(metrics.cssContentSize.height, FULL_PAGE_MAX_HEIGHT),
  };
  const area = request.box ?? (request.fullPage ? whole : visible);
  if (area.width < 1 || area.height < 1) {
    throw new PageToolError('failed', 'There is nothing to capture there.');
  }
  const { data } = await cdp.send<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: {
      x: area.x + scroll.x,
      y: area.y + scroll.y,
      width: area.width,
      height: area.height,
      scale: 1,
    },
  });
  const captured = nativeImage.createFromBuffer(Buffer.from(data, 'base64'));
  const maxWidth = request.maxWidth ?? BROWSER_SCREENSHOT_WIDTH;
  const sized =
    captured.getSize().width > maxWidth
      ? captured.resize({ width: maxWidth, quality: 'good' })
      : captured;
  const size = sized.getSize();
  const hidden = (await sensitiveBoxes(cdp)).filter((box) => overlaps(box, area));
  if (hidden.length === 0) return { ...encoded(sized), ...size, masked: 0 };
  const scale = size.width / area.width;
  const painted = paintBoxes(
    sized.toBitmap(),
    size,
    hidden.map((box) => scaledBox(box, scale, area)),
  );
  const masked = nativeImage.createFromBitmap(painted, size);
  return { ...encoded(masked), ...size, masked: hidden.length };
}
