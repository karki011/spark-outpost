export interface Point {
  x: number;
  y: number;
}

const POINTS = 72;
const WOBBLE = 0.16;
const WAVES = [
  { lobes: 2, weight: 0.5 },
  { lobes: 3, weight: 0.3 },
  { lobes: 5, weight: 0.2 },
];

export const BLOB_OVERSHOOT = 1 / (1 - WOBBLE) + 0.02;

function reach(angle: number, seed: number, drift: number): number {
  const wave = WAVES.reduce(
    (sum, { lobes, weight }, index) =>
      sum + weight * Math.sin(lobes * angle + seed * (index + 1) * 2.399 + drift * (index + 1)),
    0,
  );
  return 1 + WOBBLE * wave;
}

export function inkBlob(origin: Point, radius: number, seed: number, drift = 0): string {
  const points = Array.from({ length: POINTS }, (_, index) => {
    const angle = (index / POINTS) * Math.PI * 2;
    const distance = radius * reach(angle, seed, drift);
    const x = origin.x + Math.cos(angle) * distance;
    const y = origin.y + Math.sin(angle) * distance;
    return `${x.toFixed(1)}px ${y.toFixed(1)}px`;
  });
  return `polygon(${points.join(', ')})`;
}

export function farthestCorner(origin: Point, width: number, height: number): number {
  return Math.hypot(Math.max(origin.x, width - origin.x), Math.max(origin.y, height - origin.y));
}

export function inkFrames(origin: Point, width: number, height: number, seed: number): string[] {
  const cover = farthestCorner(origin, width, height) * BLOB_OVERSHOOT;
  return [
    inkBlob(origin, 0, seed),
    inkBlob(origin, cover * 0.42, seed, 0.5),
    inkBlob(origin, cover * 0.78, seed, 1.1),
    inkBlob(origin, cover, seed, 1.6),
  ];
}
