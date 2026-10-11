export type Stock = Record<string, number | null>;

export function available(stock: Stock, sku: string): number {
  const count = stock[sku];
  if (count === null) return 0;
  return count;
}

export function canFill(stock: Stock, sku: string, quantity: number): boolean {
  return available(stock, sku) >= quantity;
}
