import './calendar-card.css';
import type { CalendarStatus } from '@spark-outpost/contracts';
import { CalendarAccounts, CalendarRows, RowsHeader } from './CalendarAccounts.tsx';
import { CalendarName } from './CalendarName.tsx';
import { useCalendarChoices } from './use-calendar-choices.ts';

export const NUDGE_CALENDARS_LABEL = 'Calendars that nudge';

export function CalendarNudgeList({ status }: { status: CalendarStatus }) {
  const { mac, google, change, error } = useCalendarChoices(status.accounts);
  if (mac.length === 0 && google.length === 0) return null;
  return (
    <div className="cal-nudge-list" role="group" aria-labelledby="notify-calendars">
      <p className="cal-nudge-list-h">
        <b id="notify-calendars">{NUDGE_CALENDARS_LABEL}</b>
        <small>
          Spark nudges before meetings on these. Every included calendar counts as busy.
        </small>
      </p>
      {mac.length > 0 && (
        <section className="cal-source" aria-label="macOS Calendar">
          <div className="cal-src-h">
            <h3>macOS Calendar</h3>
          </div>
          <CalendarAccounts accounts={mac} onChange={change} />
        </section>
      )}
      {google.map((account) => (
        <section key={account.id} className="cal-source" aria-label={`Google, ${account.title}`}>
          <div className="cal-src-h">
            <h3>Google</h3>
            <small>
              <CalendarName name={account.title} />
            </small>
          </div>
          <RowsHeader />
          <CalendarRows calendars={account.calendars} onChange={change} />
        </section>
      ))}
      {error && (
        <p className="home-error" role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}
