export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ToolbarPlacement {
  left: number;
  top: number;
  side: 'below' | 'above';
}

interface PlacementInput {
  start: Box;
  end: Box;
  bounds: Box;
  size: { width: number; height: number };
}

export const TOOLBAR_GAP = 8;
const EDGE = 8;

export function isOutOfView({ start, end, bounds }: Omit<PlacementInput, 'size'>): boolean {
  return end.bottom < bounds.top || start.top > bounds.bottom;
}

export function toolbarPlacement({ start, end, bounds, size }: PlacementInput): ToolbarPlacement {
  const minLeft = bounds.left + EDGE;
  const maxLeft = Math.max(minLeft, bounds.right - EDGE - size.width);
  const left = Math.min(Math.max(end.right - size.width / 2, minLeft), maxLeft);
  const below = end.bottom + TOOLBAR_GAP;
  if (below + size.height <= bounds.bottom - EDGE) return { left, top: below, side: 'below' };
  const above = start.top - TOOLBAR_GAP - size.height;
  if (above >= bounds.top + EDGE) return { left, top: above, side: 'above' };
  const top = Math.min(
    Math.max(below, bounds.top + EDGE),
    Math.max(bounds.top + EDGE, bounds.bottom - EDGE - size.height),
  );
  return { left, top, side: 'below' };
}
