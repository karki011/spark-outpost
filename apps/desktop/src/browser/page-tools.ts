import { nativeImage, type NativeImage } from 'electron';
import { BROWSER_SCREENSHOT_WIDTH, type BrowserBox } from '@spark-outpost/contracts';
import type { Cdp } from './cdp.ts';
import { paintBoxes, scaledBox } from './mask.ts';
import { PageToolError, boxOf, sensitiveBackendIds } from './page-read.ts';

const FULL_PAGE_MAX_HEIGHT = 6000;
const PNG_MAX_BYTES = 3_500_000;
const JPEG_QUALITY = 82;

interface LayoutMetrics {
  cssVisualViewport: {
    pageX: number;
    pageY: number;
    clientWidth: number;
    clientHeight: number;
    zoom?: number;
  };
  cssContentSize: { width: number; height: number };
}

export interface ShotRequest {
  box?: BrowserBox | null;
  fullPage?: boolean;
  maxWidth?: number;
  filled?: ReadonlySet<number>;
}

export interface Shot {
  data: Buffer;
  mediaType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  masked: number;
}

async function sensitiveBoxes(cdp: Cdp, filled: ReadonlySet<number>): Promise<BrowserBox[]> {
  const boxes: BrowserBox[] = [];
  for (const backendNodeId of new Set([...(await sensitiveBackendIds(cdp)), ...filled])) {
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
  const pageZoom = viewport.zoom ?? 1;
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
      x: (area.x + scroll.x) * pageZoom,
      y: (area.y + scroll.y) * pageZoom,
      width: area.width * pageZoom,
      height: area.height * pageZoom,
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
  const hidden = (await sensitiveBoxes(cdp, request.filled ?? new Set())).filter((box) =>
    overlaps(box, area),
  );
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
