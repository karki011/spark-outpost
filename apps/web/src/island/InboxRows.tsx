import type { CSSProperties, ReactNode } from 'react';
import type { CalendarLine } from '../calendar/island-calendar.ts';
import type { IslandCalendar } from '../calendar/use-island-calendar.ts';
import { XIcon } from '../ui/icons.tsx';
import { agentsProgress, shortAgo, type FinishedRow, type RunningRow } from './inbox-model.ts';
import type { Card } from './island-model.ts';
import { waitingTitle } from './island-rest-line.ts';

interface RowProps {
  kind: string;
  title: string;
  detail: string;
  time: string | null;
  onOpen: () => void;
  children?: ReactNode;
  after?: ReactNode;
}

function Row({ kind, title, detail, time, onOpen, children, after }: RowProps) {
  return (
    <li className="isl-inbox-row" data-kind={kind}>
      <button
        type="button"
        className="isl-inbox-row-open"
        title={`Open ${title} in Spark`}
        onClick={onOpen}
      >
        <span className="isl-inbox-dot" aria-hidden="true" />
        <span className="isl-inbox-row-text">
          <span className="isl-inbox-row-title">{title}</span>
          <span className="isl-inbox-sub"> · {detail}</span>
        </span>
        {time && <time className="isl-inbox-time">{time}</time>}
        {children}
      </button>
      {after}
    </li>
  );
}

export function Section({
  id,
  label,
  count,
  children,
}: {
  id: string;
  label: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="isl-inbox-sec" aria-labelledby={id}>
      <h3 id={id}>
        {label}
        {count !== undefined && <span aria-hidden="true"> · {count}</span>}
      </h3>
      <ul>{children}</ul>
    </section>
  );
}

export function RunningRows(props: {
  rows: readonly RunningRow[];
  now: number;
  onOpenChat: (id: string) => void;
}) {
  return props.rows.map(({ chat, detail, agents }) => (
    <Row
      key={chat.id}
      kind="running"
      title={chat.title}
      detail={detail}
      time={shortAgo(chat.updatedAt, props.now)}
      onOpen={() => props.onOpenChat(chat.id)}
    >
      {agents && agents.total > 1 && (
        <span
          className="isl-inbox-progress"
          aria-hidden="true"
          style={{ '--done': agentsProgress(agents) } as CSSProperties}
        />
      )}
    </Row>
  ));
}

export function FinishedRows(props: {
  rows: readonly FinishedRow[];
  onOpenChat: (id: string) => void;
  onClear: (id: string) => void;
}) {
  return props.rows.map(({ kind, chat, detail }) => (
    <Row
      key={chat.id}
      kind={kind}
      title={chat.title}
      detail={detail}
      time={null}
      onOpen={() => props.onOpenChat(chat.id)}
      after={
        <button
          type="button"
          className="isl-inbox-x"
          data-in-place
          title="Clear"
          aria-label={`Clear ${chat.title}`}
          onClick={() => props.onClear(chat.id)}
        >
          <XIcon />
        </button>
      }
    />
  ));
}

export function AsideRows(props: {
  cards: readonly Card[];
  now: number;
  onOpenChat: (id: string) => void;
}) {
  return props.cards.map((card) => (
    <Row
      key={card.approval?.id ?? card.chat.id}
      kind="aside"
      title={card.chat.title}
      detail={`set aside · ${waitingTitle(card)}`}
      time={shortAgo(card.approval?.createdAt ?? card.chat.updatedAt, props.now)}
      onOpen={() => props.onOpenChat(card.chat.id)}
    />
  ));
}

const CALENDAR_ROWS: ReadonlySet<CalendarLine['kind']> = new Set(['capture', 'catch-up']);

export function calendarRow(line: CalendarLine | null): CalendarLine | null {
  return line && CALENDAR_ROWS.has(line.kind) ? line : null;
}

export function CalendarRow({ line, calendar }: { line: CalendarLine; calendar: IslandCalendar }) {
  return (
    <li className="isl-inbox-row isl-inbox-cal" data-kind="calendar" data-in-place>
      <span className="isl-inbox-dot" aria-hidden="true" />
      <span className="isl-inbox-row-text">{line.text}</span>
      {line.capture && (
        <button type="button" className="isl-btn" onClick={() => calendar.onCapture(line)}>
          Start a chat
        </button>
      )}
      <button
        type="button"
        className="isl-inbox-x"
        title="Dismiss"
        aria-label={`Dismiss: ${line.text}`}
        onClick={() => calendar.onDismiss(line)}
      >
        <XIcon />
      </button>
    </li>
  );
}
