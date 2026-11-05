export interface Camera {
  x: number;
  y: number;
  k: number;
}

export interface Viewport {
  width: number;
  height: number;
  inset: number;
}

export type Box = [number, number, number, number];

export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 14;

export function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export function toScreenX(camera: Camera, viewport: Viewport, x: number): number {
  return (x - camera.x) * camera.k + viewport.width / 2;
}

export function toScreenY(camera: Camera, viewport: Viewport, y: number): number {
  return (y - camera.y) * camera.k + viewport.height / 2;
}

export function toWorld(camera: Camera, viewport: Viewport, sx: number, sy: number) {
  return {
    x: (sx - viewport.width / 2) / camera.k + camera.x,
    y: (sy - viewport.height / 2) / camera.k + camera.y,
  };
}

export function fitZoom(box: Box, viewport: Viewport, pad: number): number {
  const width = Math.max(1, viewport.width - viewport.inset - pad * 2);
  const height = Math.max(1, viewport.height - pad * 2);
  return Math.max(1e-4, Math.min(width / (box[2] - box[0]), height / (box[3] - box[1])));
}

export function fit(box: Box, viewport: Viewport, pad: number): Camera {
  const k = fitZoom(box, viewport, pad);
  return { x: (box[0] + box[2]) / 2 + viewport.inset / 2 / k, y: (box[1] + box[3]) / 2, k };
}

export function zoomAt(
  camera: Camera,
  viewport: Viewport,
  sx: number,
  sy: number,
  nextK: number,
): Camera {
  const anchor = toWorld(camera, viewport, sx, sy);
  return {
    k: nextK,
    x: anchor.x - (sx - viewport.width / 2) / nextK,
    y: anchor.y - (sy - viewport.height / 2) / nextK,
  };
}

export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x - dx / camera.k, y: camera.y - dy / camera.k };
}

export function between(from: Camera, to: Camera, t: number): Camera {
  const e = ease(clamp(t, 0, 1));
  return {
    x: from.x + (to.x - from.x) * e,
    y: from.y + (to.y - from.y) * e,
    k: Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e),
  };
}

export function visibleBox(camera: Camera, viewport: Viewport, margin = 0): Box {
  const topLeft = toWorld(camera, viewport, -margin, -margin);
  const bottomRight = toWorld(
    camera,
    viewport,
    viewport.width - viewport.inset + margin,
    viewport.height + margin,
  );
  return [topLeft.x, topLeft.y, bottomRight.x, bottomRight.y];
}
