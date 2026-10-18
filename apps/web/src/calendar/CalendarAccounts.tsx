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

interface RowProps {
  calendar: CalendarChoice;
  onChange: ChangeChoice;
  withEdit: boolean;
}

function EditSwitch({ calendar, onChange }: Omit<RowProps, 'withEdit'>) {
  return (
    <span className="cal-col">
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

function CalendarRow({ calendar, onChange, withEdit }: RowProps) {
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
      <span className="cal-nudge cal-col">
        <BlobToggle
          size="sm"
          kind="plain"
          label={`${NUDGE_LABEL}, ${calendar.title}`}
          checked={calendar.include && calendar.nudges}
          disabled={!calendar.include}
          onChange={(checked) => onChange(calendar.key, { nudges: checked })}
        />
      </span>
      {withEdit && <EditSwitch calendar={calendar} onChange={onChange} />}
    </li>
  );
}

export function RowsHeader({ withEdit = false }: { withEdit?: boolean }) {
  return (
    <p className="cal-rows-h" aria-hidden="true">
      <span>Include</span>
      <span className="cal-cols">
        <span className="cal-col">{NUDGE_LABEL}</span>
        {withEdit && <span className="cal-col">{AGENTS_EDIT_LABEL}</span>}
      </span>
    </p>
  );
}

interface RowsProps {
  calendars: readonly CalendarChoice[];
  onChange: ChangeChoice;
  withEdit?: boolean;
}

export function CalendarRows({ calendars, onChange, withEdit = false }: RowsProps) {
  const [all, setAll] = useState(false);
  const listId = useId();
  const hidden = calendars.length - ROWS_SHOWN;
  const shown = all || hidden <= 0 ? calendars : calendars.slice(0, ROWS_SHOWN);
  return (
    <>
      <ul className="cal-rows" id={listId}>
        {shown.map((calendar) => (
          <CalendarRow
            key={calendar.key}
            calendar={calendar}
            onChange={onChange}
            withEdit={withEdit}
          />
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
  withEdit = false,
}: {
  accounts: readonly CalendarAccount[];
  onChange: ChangeChoice;
  withEdit?: boolean;
}) {
  return (
    <div className="cal-accounts">
      <RowsHeader withEdit={withEdit} />
      {accounts.map((account) => (
        <section key={account.id} className="cal-acct" aria-label={account.title}>
          <p className="cal-acct-h">
            <CalendarName name={account.title} />
            <small>{SOURCE_LABEL[account.kind]}</small>
          </p>
          <CalendarRows calendars={account.calendars} onChange={onChange} withEdit={withEdit} />
        </section>
      ))}
    </div>
  );
}
