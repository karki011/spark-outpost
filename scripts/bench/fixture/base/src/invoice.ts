import { addDays, formatIsoDate } from './dates.ts';
import { formatCents } from './money.ts';

export interface LineItem {
  description: string;
  cents: number;
  quantity: number;
}

export interface Invoice {
  id: string;
  customer: string;
  issued: Date;
  items: LineItem[];
  discountRate: number;
}

export function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function titleCase(text: string): string {
  return text
    .split(' ')
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function subtotalCents(invoice: Invoice): number {
  return invoice.items.reduce((sum, item) => sum + item.cents * item.quantity, 0);
}

export function totalCents(invoice: Invoice): number {
  return Math.round(subtotalCents(invoice) * (1 - invoice.discountRate));
}

export function invoiceHeader(invoice: Invoice): string {
  return `${invoice.id} · ${titleCase(invoice.customer)} · ${formatCents(totalCents(invoice))}`;
}

export function dueLabel(invoice: Invoice, termsDays: number): string {
  return `Due ${formatIsoDate(addDays(invoice.issued, termsDays))}`;
}
