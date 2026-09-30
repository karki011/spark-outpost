export interface NavBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Direction = 'left' | 'right' | 'up' | 'down';

export const ARROWS: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

const SIDEWAYS_COST = 2.5;

function centre(box: NavBox): [number, number] {
  return [box.x + box.width / 2, box.y + box.height / 2];
}

export function nearest(
  boxes: readonly NavBox[],
  from: string,
  direction: Direction,
): string | null {
  const start = boxes.find((box) => box.id === from);
  if (!start) return boxes[0]?.id ?? null;
  const [sx, sy] = centre(start);
  let best: { id: string; score: number } | null = null;
  for (const box of boxes) {
    if (box.id === from) continue;
    const [cx, cy] = centre(box);
    const dx = cx - sx;
    const dy = cy - sy;
    const along =
      direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy;
    const across = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 1) continue;
    const score = along + across * SIDEWAYS_COST;
    if (!best || score < best.score) best = { id: box.id, score };
  }
  return best?.id ?? null;
}
