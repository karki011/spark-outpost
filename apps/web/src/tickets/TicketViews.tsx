import type { KeyboardEvent } from 'react';
import type { AttentionSettings } from '@spark-outpost/contracts';
import { CHIP_GLYPHS } from './StatusChip.tsx';
import { flowChip } from './ticket-flow.ts';
import { Glyph, type GlyphName } from './ticket-icons.tsx';
import { attentionRule, type TicketView } from './ticket-model.ts';
import { nextViewIndex, type ViewItem } from './ticket-views.ts';

interface TicketViewsProps {
  items: readonly ViewItem[];
  current: TicketView | null;
  settings: AttentionSettings;
  onView: (view: TicketView) => void;
}

function glyphOf(view: TicketView): GlyphName {
  if (view === 'inbox') return 'home';
  if (view === 'snoozed') return 'snooze';
  return CHIP_GLYPHS[flowChip(view, 'none').tone];
}

function itemClass(item: ViewItem): string {
  if (item.count === 0) return 'ib-item empty';
  return item.id === 'attention' ? 'ib-item attn' : 'ib-item';
}

function moveFocus(event: KeyboardEvent<HTMLElement>) {
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.ib-item')];
  const at = buttons.indexOf(event.target as HTMLButtonElement);
  const next = at < 0 ? null : nextViewIndex(event.key, at, buttons.length);
  if (next === null) return;
  event.preventDefault();
  buttons[next]?.focus();
}

export function TicketViews({ items, current, settings, onView }: TicketViewsProps) {
  const tabStop = current ?? items[0]?.id;
  return (
    <nav className="ib-nav" aria-label="Ticket views" onKeyDown={moveFocus}>
      <p className="ib-sec">Views</p>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={itemClass(item)}
          aria-pressed={current === item.id}
          tabIndex={item.id === tabStop ? 0 : -1}
          onClick={() => onView(item.id)}
        >
          <Glyph name={glyphOf(item.id)} size={15} />
          <span className="l">{item.label}</span>
          <span className="n">{item.count}</span>
        </button>
      ))}
      <div className="ib-foot">
        <b>Attention rules</b>
        <p>{attentionRule(settings)}</p>
      </div>
    </nav>
  );
}
