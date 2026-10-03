import type { ReactNode } from 'react';
import type { PendingSummary } from './pending-summary.ts';
import { usePendingEntry } from './status-context.ts';

interface PendingProps {
  id: string;
  order: string;
  summary: PendingSummary;
  pending: boolean;
  children: ReactNode;
}

export function Pending({ id, order, summary, pending, children }: PendingProps) {
  usePendingEntry(id, order, summary, pending);
  return children;
}
