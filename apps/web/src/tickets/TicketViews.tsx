import type { AttentionSettings, TicketSection } from '@spark-outpost/contracts';
import { Glyph, type GlyphName } from './ticket-icons.tsx';
import { SECTIONS, type TicketView } from './ticket-model.ts';

const ICONS: Record<TicketView, GlyphName> = {
  inbox: 'home',
  attention: 'flag',
  working: 'chat',
  pr_ready: 'pr',
  in_review: 'clock',
  up_next: 'play',
  done: 'box',
  snoozed: 'snooze',
};

interface TicketViewsProps {
  view: TicketView;
  total: number;
  counts: Record<TicketSection, number>;
  snoozed: number;
  settings: AttentionSettings;
  onView: (view: TicketView) => void;
}

const days = (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`;

export function TicketViews({ view, total, counts, snoozed, settings, onView }: TicketViewsProps) {
  const items: { id: TicketView; label: string; count: number }[] = [
    { id: 'inbox', label: 'Inbox', count: total },
    ...SECTIONS.map((section) => ({
      id: section.id,
      label: section.label,
      count: counts[section.id],
    })),
    ...(snoozed > 0 || view === 'snoozed'
      ? [{ id: 'snoozed' as const, label: 'Snoozed', count: snoozed }]
      : []),
  ];
  return (
    <nav className="ib-nav" aria-label="Ticket views">
      <p className="ib-sec">Views</p>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={item.id === 'attention' && item.count > 0 ? 'ib-item attn' : 'ib-item'}
          aria-pressed={view === item.id}
          onClick={() => onView(item.id)}
        >
          <Glyph name={ICONS[item.id]} size={15} />
          <span className="l">{item.label}</span>
          <span className="n">{item.count}</span>
        </button>
      ))}
      <div className="ib-foot">
        <b>Attention rules</b>
        <p>
          High or Urgent not started after {days(settings.idleDays)} · due within{' '}
          {days(settings.dueDays)} · in review {days(settings.reviewDays)} or more · a chat waiting
          on you · blocked · a failed status move · a pull request with changes requested or
          approved.
        </p>
      </div>
    </nav>
  );
}
