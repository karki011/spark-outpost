type Point = [number, number];

const TAU = Math.PI * 2;

export function clipSegment(
  a: Point,
  b: Point,
  width: number,
  height: number,
  margin = 8,
): [Point, Point] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a[0] + margin],
    [dx, width + margin - a[0]],
    [-dy, a[1] + margin],
    [dy, height + margin - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [
    [a[0] + dx * t0, a[1] + dy * t0],
    [a[0] + dx * t1, a[1] + dy * t1],
  ];
}

function wrap(angle: number): number {
  return ((((angle + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

export function visibleArc(
  cx: number,
  cy: number,
  r: number,
  width: number,
  height: number,
): [number, number] | null {
  const nearX = Math.max(0, Math.min(width, cx));
  const nearY = Math.max(0, Math.min(height, cy));
  if (Math.hypot(nearX - cx, nearY - cy) > r) return null;
  const corners: Point[] = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ];
  if (corners.every(([x, y]) => Math.hypot(x - cx, y - cy) < r)) return null;
  if (cx >= 0 && cx <= width && cy >= 0 && cy <= height) return [0, TAU];
  const middle = Math.atan2(height / 2 - cy, width / 2 - cx);
  const offsets = corners.map(([x, y]) => wrap(Math.atan2(y - cy, x - cx) - middle));
  return [middle + Math.min(...offsets), middle + Math.max(...offsets)];
}
