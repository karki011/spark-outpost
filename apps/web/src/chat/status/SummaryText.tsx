import type { PendingSummary } from './pending-summary.ts';
import { capitalized } from './status-text.ts';

export function SummaryText({
  summary,
  lead = false,
}: {
  summary: PendingSummary;
  lead?: boolean;
}) {
  const action = lead ? capitalized(summary.action) : summary.action;
  if (!summary.subject) return action;
  return (
    <>
      {action} {summary.code ? <code>{summary.subject}</code> : summary.subject}
    </>
  );
}
