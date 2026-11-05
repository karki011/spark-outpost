import { formatCents } from './money.ts';
import type { Invoice, LineItem } from './invoice.ts';

export interface ReturnedItem {
  description: string;
  quantity: number;
}

function itemFor(invoice: Invoice, description: string): LineItem {
  const item = invoice.items.find((candidate) => candidate.description === description);
  if (!item) throw new Error(`No item called ${description} on ${invoice.id}.`);
  return item;
}

export function creditNoteCents(invoice: Invoice, returned: ReturnedItem[]): number {
  const gross = returned.reduce((sum, back) => {
    const item = itemFor(invoice, back.description);
    if (back.quantity > item.quantity) throw new Error(`Too many ${back.description} returned.`);
    return sum + item.cents * back.quantity;
  }, 0);
  return -Math.round(gross * (1 - invoice.discountRate));
}

export function creditNoteLine(invoice: Invoice, returned: ReturnedItem[]): string {
  return `Credit for ${invoice.id}: ${formatCents(creditNoteCents(invoice, returned))}`;
}
