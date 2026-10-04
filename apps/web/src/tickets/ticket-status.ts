import { ticketStatusLabels, type TicketStatus } from '@spark-outpost/contracts';
import type { GlyphName } from './ticket-icons.tsx';

export type StatusCategory = TicketStatus | 'blocked';

const BLOCKED = /\b(blocked|on hold)\b/i;

export function statusCategory(status: TicketStatus, name: string): StatusCategory {
  return status !== 'done' && BLOCKED.test(name) ? 'blocked' : status;
}

const GLYPHS: Record<StatusCategory, GlyphName> = {
  todo: 'circle',
  in_progress: 'play',
  in_review: 'eye',
  blocked: 'blocked',
  done: 'check',
};

export interface StatusBadgeFacts {
  category: StatusCategory;
  label: string;
  glyph: GlyphName;
}

export function statusBadge(status: TicketStatus, name: string): StatusBadgeFacts {
  const category = statusCategory(status, name);
  return { category, label: name.trim() || ticketStatusLabels[status], glyph: GLYPHS[category] };
}

const DAY = 24 * 3_600_000;

export function createdText(createdAt: string | null, now: number): string | null {
  if (!createdAt) return null;
  const at = Date.parse(createdAt);
  if (Number.isNaN(at)) return null;
  const days = Math.floor(Math.max(0, now - at) / DAY);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return exactDate(createdAt);
}

export function exactDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function reportedText(
  ticket: { reporter: { name: string } | null; createdAt: string | null },
  now: number,
): string | null {
  const created = createdText(ticket.createdAt, now);
  if (ticket.reporter && created) return `${ticket.reporter.name} · created ${created}`;
  if (ticket.reporter) return ticket.reporter.name;
  return created ? `Created ${created}` : null;
}
