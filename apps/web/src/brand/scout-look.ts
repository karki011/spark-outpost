export interface LookTarget {
  x: number;
  y: number;
}

const REACH = 2.8;
const FULL_REACH_AT_PX = 220;
const VERTICAL_SHARE = 0.8;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function scoutFaceCenter(box: Box): LookTarget | null {
  if (!box.width) return null;
  return { x: box.left + box.width / 2, y: box.top + box.height * 0.6 };
}

export function scoutLookTransform(face: LookTarget, pointer: LookTarget): string {
  const dx = pointer.x - face.x;
  const dy = pointer.y - face.y;
  const distance = Math.hypot(dx, dy) || 1;
  const magnitude = REACH * Math.min(1, distance / FULL_REACH_AT_PX);
  const x = ((dx / distance) * magnitude).toFixed(1);
  const y = ((dy / distance) * magnitude * VERTICAL_SHARE).toFixed(1);
  return `translate(${Number(x)}px,${Number(y)}px)`;
}
