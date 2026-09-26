export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function parseCents(text: string): number {
  const trimmed = text.trim();
  const negative = trimmed.startsWith('(') || trimmed.endsWith(')');
  const cleaned = trimmed.replace(/[$,\s()]/g, '');
  const value = Number(cleaned);
  if (cleaned === '' || Number.isNaN(value)) throw new Error(`Not an amount: ${text}`);
  const cents = Math.round(Math.abs(value) * 100);
  return negative ? -cents : cents;
}
