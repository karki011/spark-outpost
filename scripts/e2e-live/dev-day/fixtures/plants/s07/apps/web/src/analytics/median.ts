export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const copy = [...values];
  return copy[Math.floor(copy.length / 2)]!;
}

export function medianLabel(values: readonly number[]): string {
  const middle = median(values);
  return middle === null ? '—' : middle.toFixed(2);
}
