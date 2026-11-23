export const BADGE_DOT_SIZE = 16;

const BADGE_BGR = [0x1c, 0x2b, 0xc4];
const EDGE_SOFTNESS = 1;

export function badgeDotPixels(size: number): Buffer {
  const pixels = Buffer.alloc(size * size * 4);
  const centre = size / 2;
  const radius = size / 2 - 0.5;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x + 0.5 - centre, y + 0.5 - centre);
      const coverage = Math.min(1, Math.max(0, (radius - distance) / EDGE_SOFTNESS + 0.5));
      const alpha = Math.round(coverage * 255);
      const offset = (y * size + x) * 4;
      pixels[offset] = Math.round((BADGE_BGR[0]! * alpha) / 255);
      pixels[offset + 1] = Math.round((BADGE_BGR[1]! * alpha) / 255);
      pixels[offset + 2] = Math.round((BADGE_BGR[2]! * alpha) / 255);
      pixels[offset + 3] = alpha;
    }
  }
  return pixels;
}
