export interface Point {
  x: number;
  y: number;
}

export interface InkLobe {
  dx: number;
  dy: number;
  size: number;
  drift: number;
}

export const INK_SOLID = 0.88;
const LOBE_COUNT = 3;
const OVERSHOOT = 1.02;

function unit(seed: number, index: number): number {
  const value = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export function inkLobes(seed: number): InkLobe[] {
  return Array.from({ length: LOBE_COUNT }, (_, index) => {
    const angle = ((index + unit(seed, index)) / LOBE_COUNT) * Math.PI * 2;
    const offset = 0.16 + 0.1 * unit(seed, index + 10);
    return {
      dx: Math.cos(angle) * offset,
      dy: Math.sin(angle) * offset,
      size: 0.84 + 0.08 * unit(seed, index + 20),
      drift: 0.16 * (unit(seed, index + 30) - 0.5),
    };
  });
}

export function farthestCorner(origin: Point, width: number, height: number): number {
  return Math.hypot(Math.max(origin.x, width - origin.x), Math.max(origin.y, height - origin.y));
}

export function inkReach(origin: Point, width: number, height: number): number {
  return (farthestCorner(origin, width, height) / INK_SOLID) * OVERSHOOT;
}

export function inkVariables(origin: Point, seed: number): Record<string, string> {
  const variables: Record<string, string> = {
    '--ink-x': `${origin.x.toFixed(1)}px`,
    '--ink-y': `${origin.y.toFixed(1)}px`,
    '--ink-solid': String(INK_SOLID),
  };
  inkLobes(seed).forEach((lobe, index) => {
    const n = index + 1;
    variables[`--ink-dx${n}`] = lobe.dx.toFixed(3);
    variables[`--ink-dy${n}`] = lobe.dy.toFixed(3);
    variables[`--ink-size${n}`] = lobe.size.toFixed(3);
    variables[`--ink-drift${n}`] = lobe.drift.toFixed(3);
  });
  return variables;
}
