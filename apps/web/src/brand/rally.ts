export interface Point {
  x: number;
  y: number;
}

export interface Segment {
  seconds: number;
  step?: (progress: number) => void;
  done?: () => void;
}

export type Side = 'left' | 'right';

export const STAGE = { width: 300, height: 170, ground: 156, reach: 50, hand: 30, arc: 70 };

export const other = (side: Side): Side => (side === 'left' ? 'right' : 'left');

export const handOf = (side: Side): Point => ({
  x: side === 'left' ? STAGE.reach + 22 : STAGE.width - STAGE.reach - 22,
  y: STAGE.ground - STAGE.hand,
});

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function arcPoint(from: Point, to: Point, height: number, t: number): Point {
  return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) - 4 * height * t * (1 - t) };
}

export function curvePoint(from: Point, via: Point, to: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * via.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * via.y + t * t * to.y,
  };
}

export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function between(random: () => number, low: number, high: number): number {
  return low + random() * (high - low);
}

export const HERO_NAMES = [
  'Captain Merge',
  'Rebase Ranger',
  'Null Hunter',
  'Lint Lightning',
  'The Green Build',
  'Hotfix Hawk',
  'Commit Comet',
  'Doctor Diff',
];

const PROVIDER_HUES = [24, 112, 205, 318];

export function heroHue(random: () => number): number {
  let hue = Math.floor(random() * 360);
  while (PROVIDER_HUES.some((taken) => Math.abs(taken - hue) < 25)) hue = (hue + 37) % 360;
  return hue;
}
