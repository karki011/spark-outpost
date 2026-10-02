import type { TicketSection } from '@spark-outpost/contracts';
import { CHIP_GLYPHS } from './StatusChip.tsx';
import { flowChip, summaryText } from './ticket-flow.ts';
import { Glyph } from './ticket-icons.tsx';
import { SECTIONS, type TicketView } from './ticket-model.ts';

interface SummaryStripProps {
  view: TicketView;
  total: number;
  counts: Record<TicketSection, number>;
  snoozed: number;
  onView: (view: TicketView) => void;
}

export function SummaryStrip({ view, total, counts, snoozed, onView }: SummaryStripProps) {
  const toggle = (next: TicketView) => onView(view === next ? 'inbox' : next);
  const shown = SECTIONS.filter((section) => counts[section.id] > 0 || view === section.id);
  return (
    <div className="tk-sum" role="group" aria-label="Show tickets by where they are">
      <button
        type="button"
        className="sum-chip all"
        aria-pressed={view === 'inbox'}
        onClick={() => onView('inbox')}
      >
        All <span className="n">{total}</span>
      </button>
      {shown.map((section) => {
        const tone = flowChip(section.id, 'none').tone;
        return (
          <button
            key={section.id}
            type="button"
            className={`sum-chip ${tone}`}
            aria-pressed={view === section.id}
            title={section.label}
            onClick={() => toggle(section.id)}
          >
            <Glyph name={CHIP_GLYPHS[tone]} size={12} />
            {summaryText(section.id, counts[section.id])}
          </button>
        );
      })}
      {(snoozed > 0 || view === 'snoozed') && (
        <button
          type="button"
          className="sum-chip snoozed"
          aria-pressed={view === 'snoozed'}
          onClick={() => toggle('snoozed')}
        >
          <Glyph name="snooze" size={12} />
          {snoozed} snoozed
        </button>
      )}
    </div>
  );
}
