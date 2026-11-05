export function firstSorted<T>(
  items: readonly T[],
  count: number,
  compare: (a: T, b: T) => number,
): T[] {
  if (count >= items.length) return [...items].sort(compare);
  if (count <= 0) return [];
  const order = Uint32Array.from(items, (_, index) => index);
  const inOrder = (a: number, b: number) => compare(items[a]!, items[b]!) || a - b;
  const last = count - 1;
  let low = 0;
  let high = order.length - 1;
  while (low < high) {
    const pivot = order[(low + high) >>> 1]!;
    let left = low;
    let right = high;
    while (left <= right) {
      while (inOrder(order[left]!, pivot) < 0) left += 1;
      while (inOrder(order[right]!, pivot) > 0) right -= 1;
      if (left > right) break;
      const swapped = order[left]!;
      order[left] = order[right]!;
      order[right] = swapped;
      left += 1;
      right -= 1;
    }
    if (last <= right) high = right;
    else if (last >= left) low = left;
    else break;
  }
  return Array.from(order.subarray(0, count))
    .sort(inOrder)
    .map((index) => items[index]!);
}
