export const FLOAT_BELOW = 420;
export const DOCK_ABOVE = 480;
export const SPLIT_FLOAT_BELOW = 360;
export const SPLIT_DOCK_ABOVE = 420;

interface RoomFacts {
  rooms: readonly number[];
  sideWidth: number;
  docked: boolean;
  floating: boolean;
}

export function floatsSidebar({ rooms, sideWidth, docked, floating }: RoomFacts): boolean {
  if (rooms.length === 0) return floating;
  const narrowest = Math.min(...rooms);
  const room = docked ? narrowest : narrowest - sideWidth / rooms.length;
  const split = rooms.length > 1;
  if (floating) return room < (split ? SPLIT_DOCK_ABOVE : DOCK_ABOVE);
  return room < (split ? SPLIT_FLOAT_BELOW : FLOAT_BELOW);
}

export function dockedSideWidth(saved: number | null, fallback: number, viewport: number): number {
  return Math.min(saved ?? fallback, viewport * 0.36);
}
