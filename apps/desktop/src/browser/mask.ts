import type { BrowserBox } from '@spark-outpost/contracts';

const MASK_BGRA = [96, 96, 96, 255] as const;

export function paintBoxes(
  bitmap: Buffer,
  size: { width: number; height: number },
  boxes: readonly BrowserBox[],
): Buffer {
  const painted = Buffer.from(bitmap);
  for (const box of boxes) {
    const left = Math.max(0, Math.floor(box.x));
    const top = Math.max(0, Math.floor(box.y));
    const right = Math.min(size.width, Math.ceil(box.x + box.width));
    const bottom = Math.min(size.height, Math.ceil(box.y + box.height));
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const at = (y * size.width + x) * 4;
        painted[at] = MASK_BGRA[0];
        painted[at + 1] = MASK_BGRA[1];
        painted[at + 2] = MASK_BGRA[2];
        painted[at + 3] = MASK_BGRA[3];
      }
    }
  }
  return painted;
}

export function scaledBox(box: BrowserBox, scale: number, origin = { x: 0, y: 0 }): BrowserBox {
  return {
    x: (box.x - origin.x) * scale,
    y: (box.y - origin.y) * scale,
    width: box.width * scale,
    height: box.height * scale,
  };
}

export function quadBox(quad: readonly number[]): BrowserBox | null {
  if (quad.length < 8) return null;
  const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!];
  const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
