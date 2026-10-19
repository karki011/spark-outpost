import './calendar-parts.css';
import { useId, useState, type CSSProperties } from 'react';
import type {
  CalendarAccount,
  CalendarChoice,
  CalendarChoicePatch,
  CalendarSourceKind,
} from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { CalendarName } from './CalendarName.tsx';

const SOURCE_LABEL: Record<CalendarSourceKind, string> = {
  local: 'On this Mac',
  exchange: 'Exchange',
  caldav: 'CalDAV',
  mobileme: 'iCloud',
  subscribed: 'Subscribed',
  birthdays: 'Birthdays',
  google: 'Google',
  other: 'Other',
};

export const NUDGE_LABEL = 'Nudge';
export const AGENTS_EDIT_LABEL = 'Agents can edit';
export const ROWS_SHOWN = 5;

export function swatch(color: string): CSSProperties {
  return { '--cal-color': color } as CSSProperties;
}

export type ChangeChoice = (key: string, patch: CalendarChoicePatch) => void;

export type RowsView = 'notify' | 'card' | 'choose' | 'edit';

const SHOWS_INCLUDE: ReadonlySet<RowsView> = new Set(['notify', 'choose']);
const SHOWS_NUDGE: ReadonlySet<RowsView> = new Set(['notify', 'card']);

interface RowProps {
  calendar: CalendarChoice;
  onChange: ChangeChoice;
  view: RowsView;
}

function EditSwitch({ calendar, onChange }: Omit<RowProps, 'view'>) {
  return (
    <span className="cal-col cal-end">
      <BlobToggle
        size="sm"
        kind="plain"
        label={`${AGENTS_EDIT_LABEL}, ${calendar.title}${calendar.writable ? '' : ' (read-only)'}`}
        checked={calendar.writable && calendar.agentsEdit}
        disabled={!calendar.writable}
        onChange={(checked) => onChange(calendar.key, { agentsEdit: checked })}
      />
    </span>
  );
}

function NudgeSwitch({ calendar, onChange }: Omit<RowProps, 'view'>) {
  return (
    <span className="cal-col cal-end">
      <BlobToggle
        size="sm"
        kind="plain"
        label={`${NUDGE_LABEL}, ${calendar.title}`}
        checked={calendar.include && calendar.nudges}
        disabled={!calendar.include}
        onChange={(checked) => onChange(calendar.key, { nudges: checked })}
      />
    </span>
  );
}

function CalendarRow({ calendar, onChange, view }: RowProps) {
  const off = !calendar.include && view !== 'edit';
  return (
    <li className="cal-row" data-off={off || undefined}>
      {SHOWS_INCLUDE.has(view) && (
        <input
          type="checkbox"
          className="cal-include"
          checked={calendar.include}
          aria-label={`Include ${calendar.title}`}
          onChange={(event) => onChange(calendar.key, { include: event.target.checked })}
        />
      )}
      <i className="cal-sw" style={swatch(calendar.color)} aria-hidden="true" />
      <CalendarName name={calendar.title} className="cal-title" />
      {calendar.ownership !== 'mine' && <span className="cal-chip">shared</span>}
      {view === 'card' && !calendar.include && <span className="cal-chip">hidden</span>}
      {SHOWS_NUDGE.has(view) && <NudgeSwitch calendar={calendar} onChange={onChange} />}
      {view === 'edit' && <EditSwitch calendar={calendar} onChange={onChange} />}
    </li>
  );
}

const HEADER: Record<RowsView, { start: string | null; end: string | null }> = {
  notify: { start: 'Include', end: NUDGE_LABEL },
  card: { start: null, end: NUDGE_LABEL },
  choose: { start: 'Include', end: null },
  edit: { start: null, end: AGENTS_EDIT_LABEL },
};

export function RowsHeader({ view = 'notify' }: { view?: RowsView }) {
  const { start, end } = HEADER[view];
  return (
    <p className="cal-rows-h" aria-hidden="true">
      <span>{start}</span>
      {end && <span className="cal-col">{end}</span>}
    </p>
  );
}

interface RowsProps {
  calendars: readonly CalendarChoice[];
  onChange: ChangeChoice;
  view?: RowsView;
}

export function CalendarRows({ calendars, onChange, view = 'notify' }: RowsProps) {
  const [all, setAll] = useState(false);
  const listId = useId();
  const hidden = calendars.length - ROWS_SHOWN;
  const shown = all || hidden <= 0 ? calendars : calendars.slice(0, ROWS_SHOWN);
  return (
    <>
      <ul className="cal-rows" id={listId}>
        {shown.map((calendar) => (
          <CalendarRow key={calendar.key} calendar={calendar} onChange={onChange} view={view} />
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          className="cal-more"
          aria-expanded={all}
          aria-controls={listId}
          onClick={() => setAll((current) => !current)}
        >
          {all ? 'Show fewer' : `Show ${hidden} more`}
        </button>
      )}
    </>
  );
}

interface AccountsProps {
  accounts: readonly CalendarAccount[];
  onChange: ChangeChoice;
  view?: RowsView;
}

export function CalendarAccounts({ accounts, onChange, view = 'notify' }: AccountsProps) {
  return (
    <div className="cal-accounts">
      <RowsHeader view={view} />
      {accounts.map((account) => (
        <section key={account.id} className="cal-acct" aria-label={account.title}>
          <p className="cal-acct-h">
            <CalendarName name={account.title} />
            <small>{SOURCE_LABEL[account.kind]}</small>
          </p>
          <CalendarRows calendars={account.calendars} onChange={onChange} view={view} />
        </section>
      ))}
    </div>
  );
}
