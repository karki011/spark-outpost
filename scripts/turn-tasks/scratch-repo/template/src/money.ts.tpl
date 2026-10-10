export function roundCents(value: number): number {
  return Math.round(value);
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100);
  const rest = String(absolute % 100).padStart(2, '0');
  return `${sign}$${dollars}.${rest}`;
}
