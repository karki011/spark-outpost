export interface OrderLine {
  sku: string;
  cents: number;
  quantity: number;
}

export function calcTotal(lines: OrderLine[]): number {
  return lines.reduce((sum, line) => sum + line.cents * line.quantity, 0);
}
