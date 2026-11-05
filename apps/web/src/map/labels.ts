export interface LabelRequest {
  id: number;
  width: number;
  height: number;
  x: number;
  y: number;
  r: number;
  priority: number;
}

export interface Obstacle {
  x: number;
  y: number;
  weight: number;
}

export interface Placement {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  hidden: boolean;
}

export interface LabelArea {
  width: number;
  height: number;
}

type Rect = [number, number, number, number];

const CELL = 48;
const OVERLAP = 1000;
const GAP = 8;

class Grid<T> {
  private cells = new Map<number, T[]>();

  private cellKey(cx: number, cy: number): number {
    return (cx + 4096) * 8192 + (cy + 4096);
  }

  add(rect: Rect, item: T): void {
    for (let cx = Math.floor(rect[0] / CELL); cx <= Math.floor(rect[2] / CELL); cx += 1) {
      for (let cy = Math.floor(rect[1] / CELL); cy <= Math.floor(rect[3] / CELL); cy += 1) {
        const key = this.cellKey(cx, cy);
        const cell = this.cells.get(key);
        if (cell) cell.push(item);
        else this.cells.set(key, [item]);
      }
    }
  }

  near(rect: Rect): Set<T> {
    const found = new Set<T>();
    for (let cx = Math.floor(rect[0] / CELL); cx <= Math.floor(rect[2] / CELL); cx += 1) {
      for (let cy = Math.floor(rect[1] / CELL); cy <= Math.floor(rect[3] / CELL); cy += 1) {
        for (const item of this.cells.get(this.cellKey(cx, cy)) ?? []) found.add(item);
      }
    }
    return found;
  }
}

function candidates(request: LabelRequest): [number, number, number][] {
  const { x, y, r, width: w, height: h } = request;
  const far = r + GAP * 2;
  const near = r * 0.6;
  return [
    [x, y - far - h / 2, 1.2],
    [x, y + far + h / 2, 1.4],
    [x - far - w / 2, y, 1.5],
    [x + far + w / 2, y, 1.5],
    [x, y - near - h / 2, 0],
    [x, y + near + h / 2, 0.4],
    [x - near - w / 2, y, 0.6],
    [x + near + w / 2, y, 0.6],
    [x - near, y - near - h / 2, 0.3],
    [x + near, y - near - h / 2, 0.3],
    [x - near, y + near + h / 2, 0.7],
    [x + near, y + near + h / 2, 0.7],
    [x, y, 3],
  ];
}

function overlaps(a: Rect, b: Rect): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

function inside(rect: Rect, area: LabelArea): boolean {
  return rect[0] >= 2 && rect[1] >= 2 && rect[2] <= area.width - 2 && rect[3] <= area.height - 2;
}

export function placeLabels(
  requests: readonly LabelRequest[],
  obstacles: readonly Obstacle[],
  area: LabelArea,
  reserved: readonly Rect[] = [],
): Placement[] {
  const obstacleGrid = new Grid<Obstacle>();
  for (const point of obstacles) obstacleGrid.add([point.x, point.y, point.x, point.y], point);
  const placedGrid = new Grid<Rect>();
  for (const rect of reserved) placedGrid.add(rect, rect);
  const ordered = [...requests].sort((a, b) => b.priority - a.priority || a.id - b.id);
  const placements = new Map<number, Placement>();
  for (const request of ordered) {
    let best: { score: number; x: number; y: number; rect: Rect } | null = null;
    for (const [cx, cy, penalty] of candidates(request)) {
      const rect: Rect = [
        cx - request.width / 2,
        cy - request.height / 2,
        cx + request.width / 2,
        cy + request.height / 2,
      ];
      if (!inside(rect, area)) continue;
      let score = penalty;
      for (const other of placedGrid.near(rect)) if (overlaps(rect, other)) score += OVERLAP;
      for (const point of obstacleGrid.near(rect)) {
        if (point.x > rect[0] && point.x < rect[2] && point.y > rect[1] && point.y < rect[3]) {
          score += point.weight;
        }
      }
      if (!best || score < best.score) best = { score, x: cx, y: cy, rect };
    }
    const hidden = !best || best.score >= OVERLAP;
    if (best && !hidden) placedGrid.add(best.rect, best.rect);
    placements.set(request.id, {
      id: request.id,
      x: best?.x ?? request.x,
      y: best?.y ?? request.y - request.r,
      width: request.width,
      height: request.height,
      hidden,
    });
  }
  return requests.map((request) => placements.get(request.id)!);
}

export function splitName(name: string, limit = 13): string[] {
  const words = name.split(' ');
  if (name.length <= limit || words.length < 2) return [name];
  let best: string[] = [name];
  let bestGap = Infinity;
  for (let cut = 1; cut < words.length; cut += 1) {
    const first = words.slice(0, cut).join(' ');
    const second = words.slice(cut).join(' ');
    const gap = Math.abs(first.length - second.length);
    if (gap < bestGap) {
      bestGap = gap;
      best = [first, second];
    }
  }
  return best;
}
