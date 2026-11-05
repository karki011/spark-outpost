import { ticketSectionSchema } from '@spark-outpost/contracts';
import type { LiveTicket } from './ticket-flow.ts';
import { countBy, SECTIONS, type TicketView } from './ticket-model.ts';

export interface ViewItem {
  id: TicketView;
  label: string;
  count: number;
}

export const DEFAULT_VIEW: TicketView = 'inbox';

const FIXED_VIEWS: readonly TicketView[] = ['inbox', 'snoozed'];

export function parseView(raw: string | null): TicketView {
  const fixed = FIXED_VIEWS.find((view) => view === raw);
  if (fixed) return fixed;
  const section = ticketSectionSchema.safeParse(raw);
  return section.success ? section.data : DEFAULT_VIEW;
}

export function viewItems(entries: readonly LiveTicket[], current: TicketView | null): ViewItem[] {
  const counts = countBy(entries);
  const snoozed = entries.filter((entry) => entry.ticket.snooze).length;
  return [
    { id: 'inbox', label: 'Inbox', count: entries.length },
    ...SECTIONS.map((section) => ({
      id: section.id,
      label: section.label,
      count: counts[section.id],
    })),
    ...(snoozed > 0 || current === 'snoozed'
      ? [{ id: 'snoozed' as const, label: 'Snoozed', count: snoozed }]
      : []),
  ];
}

const STEPS: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

export function nextViewIndex(key: string, at: number, length: number): number | null {
  if (length === 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  const step = STEPS[key];
  if (!step) return null;
  return Math.min(length - 1, Math.max(0, at + step));
}
