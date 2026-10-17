import './calendar-parts.css';
import type { CSSProperties } from 'react';
import type {
  CalendarAccount,
  CalendarChoice,
  CalendarChoicePatch,
  CalendarSourceKind,
} from '@spark-outpost/contracts';

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

export function swatch(color: string): CSSProperties {
  return { '--cal-color': color } as CSSProperties;
}

interface ChoiceProps {
  calendar: CalendarChoice;
  onChange: (key: string, patch: CalendarChoicePatch) => void;
}

function CalendarRow({ calendar, onChange }: ChoiceProps) {
  const off = !calendar.include;
  return (
    <li className="cal-row">
      <label className="cal-name">
        <input
          type="checkbox"
          checked={calendar.include}
          aria-label={`Include ${calendar.title}`}
          onChange={(event) => onChange(calendar.key, { include: event.target.checked })}
        />
        <i className="cal-sw" style={swatch(calendar.color)} aria-hidden="true" />
        <span className="cal-title">{calendar.title}</span>
        {calendar.ownership !== 'mine' && <span className="cal-chip">shared</span>}
      </label>
      <label className="cal-mini">
        <input
          type="checkbox"
          checked={calendar.nudges}
          disabled={off}
          aria-label={`Use for nudges, ${calendar.title}`}
          onChange={(event) => onChange(calendar.key, { nudges: event.target.checked })}
        />
        Use for nudges
      </label>
      <label className="cal-mini">
        <input
          type="checkbox"
          checked={calendar.busy}
          disabled={off}
          aria-label={`Counts as busy, ${calendar.title}`}
          onChange={(event) => onChange(calendar.key, { busy: event.target.checked })}
        />
        Counts as busy
      </label>
    </li>
  );
}

interface CalendarAccountsProps {
  accounts: readonly CalendarAccount[];
  onChange: (key: string, patch: CalendarChoicePatch) => void;
}

export function CalendarAccounts({ accounts, onChange }: CalendarAccountsProps) {
  return (
    <div className="cal-accounts">
      {accounts.map((account) => (
        <section key={account.id} className="cal-acct" aria-label={account.title}>
          <div className="cal-acct-h">
            <b>{account.title}</b>
            <small>{SOURCE_LABEL[account.kind]}</small>
          </div>
          <ul className="cal-rows">
            {account.calendars.map((calendar) => (
              <CalendarRow key={calendar.key} calendar={calendar} onChange={onChange} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
