import { useId, useState, type KeyboardEvent } from 'react';
import type { AttentionSettings } from '@spark-outpost/contracts';
import { ChevronIcon } from '../ui/icons.tsx';
import { Glyph, type GlyphName } from './ticket-icons.tsx';
import { attentionRule, type TicketView } from './ticket-model.ts';
import { nextViewIndex, type ViewItem } from './ticket-views.ts';

interface TicketViewsProps {
  items: readonly ViewItem[];
  current: TicketView | null;
  settings: AttentionSettings;
  onView: (view: TicketView) => void;
}

const GLYPHS: Record<TicketView, GlyphName> = {
  inbox: 'home',
  attention: 'warn',
  spark: 'chat',
  started: 'play',
  up_next: 'circle',
  review: 'pr',
  done: 'check',
  snoozed: 'snooze',
};

function itemClass(item: ViewItem): string {
  if (item.count === 0) return 'ib-item zero';
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

function AttentionRules({ settings }: { settings: AttentionSettings }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="ib-foot">
      <button
        type="button"
        className="ib-rules"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <ChevronIcon />
        Attention rules
      </button>
      <p id={id} hidden={!open}>
        {attentionRule(settings)}
      </p>
    </div>
  );
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
          <Glyph name={GLYPHS[item.id]} size={15} />
          <span className="l" title={item.label}>
            {item.label}
          </span>
          <span className="n">{item.count}</span>
        </button>
      ))}
      <AttentionRules settings={settings} />
    </nav>
  );
}
