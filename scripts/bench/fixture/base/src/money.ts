export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function parseCents(text: string): number {
  const cleaned = text.replace(/[$,\s]/g, '');
  const value = Number(cleaned);
  if (cleaned === '' || Number.isNaN(value)) throw new Error(`Not an amount: ${text}`);
  return Math.round(value * 100);
}
