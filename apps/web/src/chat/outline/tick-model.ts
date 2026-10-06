const FISHEYE_REACH = 2;

export function tickReach(index: number, activeIndex: number): number | null {
  if (activeIndex < 0) return null;
  const distance = Math.abs(index - activeIndex);
  return distance <= FISHEYE_REACH ? distance : null;
}

export function tickAfterKey(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  if (key === 'ArrowDown') return Math.min(index + 1, count - 1);
  if (key === 'ArrowUp') return Math.max(index - 1, 0);
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

interface Strip {
  scrollTop: number;
  height: number;
}

export function scrollToShow(strip: Strip, top: number, height: number): number {
  if (top < strip.scrollTop) return top;
  if (top + height > strip.scrollTop + strip.height) return top + height - strip.height;
  return strip.scrollTop;
}
