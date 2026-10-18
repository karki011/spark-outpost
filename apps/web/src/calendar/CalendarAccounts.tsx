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
export const ROWS_SHOWN = 5;

export function swatch(color: string): CSSProperties {
  return { '--cal-color': color } as CSSProperties;
}

export type ChangeChoice = (key: string, patch: CalendarChoicePatch) => void;

function CalendarRow({ calendar, onChange }: { calendar: CalendarChoice; onChange: ChangeChoice }) {
  return (
    <li className="cal-row" data-off={!calendar.include || undefined}>
      <input
        type="checkbox"
        className="cal-include"
        checked={calendar.include}
        aria-label={`Include ${calendar.title}`}
        onChange={(event) => onChange(calendar.key, { include: event.target.checked })}
      />
      <i className="cal-sw" style={swatch(calendar.color)} aria-hidden="true" />
      <CalendarName name={calendar.title} className="cal-title" />
      {calendar.ownership !== 'mine' && <span className="cal-chip">shared</span>}
      <span className="cal-nudge">
        <BlobToggle
          size="sm"
          kind="plain"
          label={`${NUDGE_LABEL}, ${calendar.title}`}
          checked={calendar.include && calendar.nudges}
          disabled={!calendar.include}
          onChange={(checked) => onChange(calendar.key, { nudges: checked })}
        />
      </span>
    </li>
  );
}

export function RowsHeader() {
  return (
    <p className="cal-rows-h" aria-hidden="true">
      <span>Include</span>
      <span>{NUDGE_LABEL}</span>
    </p>
  );
}

export function CalendarRows({
  calendars,
  onChange,
}: {
  calendars: readonly CalendarChoice[];
  onChange: ChangeChoice;
}) {
  const [all, setAll] = useState(false);
  const listId = useId();
  const hidden = calendars.length - ROWS_SHOWN;
  const shown = all || hidden <= 0 ? calendars : calendars.slice(0, ROWS_SHOWN);
  return (
    <>
      <ul className="cal-rows" id={listId}>
        {shown.map((calendar) => (
          <CalendarRow key={calendar.key} calendar={calendar} onChange={onChange} />
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

export function CalendarAccounts({
  accounts,
  onChange,
}: {
  accounts: readonly CalendarAccount[];
  onChange: ChangeChoice;
}) {
  return (
    <div className="cal-accounts">
      <RowsHeader />
      {accounts.map((account) => (
        <section key={account.id} className="cal-acct" aria-label={account.title}>
          <p className="cal-acct-h">
            <CalendarName name={account.title} />
            <small>{SOURCE_LABEL[account.kind]}</small>
          </p>
          <CalendarRows calendars={account.calendars} onChange={onChange} />
        </section>
      ))}
    </div>
  );
}
