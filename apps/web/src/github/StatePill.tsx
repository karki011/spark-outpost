import type { GithubInboxReviewSummary } from '@spark-outpost/contracts';
import { Glyph, type GlyphName } from '../tickets/ticket-icons.tsx';
import { STATE_LABEL, type PrState } from './github-model.ts';
import { Highlight } from './Highlight.tsx';
import { rowLabel } from './review/review-model.ts';

const GLYPH: Record<PrState, GlyphName> = {
  passing: 'check',
  failing: 'x-circle',
  running: 'clock',
  conflict: 'warn',
  draft: 'pr-draft',
};

export function StatePill({ state, label }: { state: PrState; label?: string | undefined }) {
  return (
    <span className={`gh-pill ${state}`}>
      <Glyph name={GLYPH[state]} size={12} />
      {label ?? STATE_LABEL[state]}
    </span>
  );
}

export function NewCommitsPill() {
  return (
    <span className="gh-pill fresh">
      <Glyph name="redo" size={12} />
      New commits
    </span>
  );
}

export function TicketChip({
  ticketKey,
  terms = [],
}: {
  ticketKey: string;
  terms?: readonly string[];
}) {
  return (
    <span className="gh-chip">
      <Highlight text={ticketKey} terms={terms} />
    </span>
  );
}

export function ReviewPill({ review }: { review: GithubInboxReviewSummary | null | undefined }) {
  const label = rowLabel(review);
  if (!label) return null;
  return (
    <span className="gh-pill review">
      <Glyph name={label.glyph} size={12} />
      {label.word}
    </span>
  );
}
