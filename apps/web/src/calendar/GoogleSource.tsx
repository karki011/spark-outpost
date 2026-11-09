import type {
  CalendarAccount,
  CalendarChoicePatch,
  GoogleAccountStatus,
} from '@spark-outpost/contracts';
import { CloudIcon, ExternalLinkIcon } from '../ui/icons.tsx';
import { relativeTime } from '../ui/relative-time.ts';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { CalendarRows, RowsHeader, type ChangeChoice } from './CalendarAccounts.tsx';
import { ConnectedPill, EDIT_HINT } from './MacSource.tsx';
import { SourceCard } from './SourceCard.tsx';
import type { GoogleCalendar } from './use-google-calendar.ts';
import { outsideTarget } from '../browser/outside-link.ts';

export const GOOGLE_CALENDAR = 'Google Calendar';
export const SIGN_IN_WITH_GOOGLE = 'Sign in with Google';

export function googleDisconnect(email: string) {
  return {
    title: `Disconnect ${email}?`,
    text: 'Spark stops showing its meetings and nudges, and signs out of Google. Your Google calendar isn’t changed. You can add it back any time.',
  };
}

const GOOGLE_EDIT_HINT = `${EDIT_HINT} Google asks you to allow changes the first time.`;

function syncLine(account: GoogleAccountStatus, now: number): string | null {
  if (account.state === 'sign_in_again') return null;
  if (account.syncedAt) return `Synced ${relativeTime(account.syncedAt, now)}`;
  return account.state === 'syncing' ? 'Syncing…' : null;
}

function GooglePill({ account }: { account: GoogleAccountStatus }) {
  if (account.state === 'ready') return <ConnectedPill />;
  if (account.state === 'sign_in_again') return <span className="cal-pill danger">Signed out</span>;
  if (account.state === 'error') return <span className="cal-pill warn">Trying again</span>;
  return <span className="cal-pill">Syncing</span>;
}

interface GoogleSourceProps {
  account: GoogleAccountStatus;
  calendars: CalendarAccount | undefined;
  google: GoogleCalendar;
  onChange: ChangeChoice;
}

export function GoogleSource({ account, calendars, google, onChange }: GoogleSourceProps) {
  const now = useMinuteClock();
  const rows = calendars?.calendars ?? [];
  const signIn = (editCalendar: string | null) =>
    google.begin({ accountId: account.id, editCalendar });
  const change = (key: string, patch: CalendarChoicePatch) => {
    if (patch.agentsEdit && !account.canEdit) signIn(key);
    else onChange(key, patch);
  };
  const note = google.noteFor === account.id ? google.flowNote : null;
  return (
    <SourceCard
      name={account.email}
      icon={<CloudIcon />}
      sync={syncLine(account, now)}
      pill={<GooglePill account={account} />}
      hasCalendars={rows.length > 0}
      startChoosing={rows.every((calendar) => !calendar.include)}
      editHint={GOOGLE_EDIT_HINT}
      disconnect={googleDisconnect(account.email)}
      busy={google.busy}
      onDisconnect={() => google.remove(account.id)}
      rows={(view) => (
        <>
          <RowsHeader view={view} />
          <CalendarRows calendars={rows} onChange={change} view={view} />
        </>
      )}
    >
      {account.message && (
        <p className={account.state === 'sign_in_again' ? 'gh-err' : 'gh-state warn'} role="status">
          {account.message}
        </p>
      )}
      {note && (
        <p className="gh-err" role="alert">
          {note}
        </p>
      )}
      {account.state === 'sign_in_again' && (
        <div className="cal-foot">
          <button
            type="button"
            className="btn primary sm"
            disabled={google.busy}
            onClick={() => signIn(null)}
          >
            Sign in again
          </button>
        </div>
      )}
    </SourceCard>
  );
}

export function GoogleSignInStatus({ google }: { google: GoogleCalendar }) {
  const asks = google.editing ? 'change events in your calendars' : 'see your calendars';
  const flowNote = google.noteFor === null ? google.flowNote : null;
  return (
    <>
      {google.waiting && (
        <div className="cal-google-wait" role="group" aria-label="Google sign-in">
          <p className="gh-note">
            Finish in your browser: Google asks you to allow Spark Outpost to {asks}, then sends you
            back here.
          </p>
          <div className="cx-actions">
            {google.flow.authorizeUrl && (
              <a
                className="btn line sm"
                href={google.flow.authorizeUrl}
                target={outsideTarget()}
                rel="noreferrer"
              >
                Open Google again
                <ExternalLinkIcon />
              </a>
            )}
            <button type="button" className="btn ghost sm" onClick={google.cancel}>
              Cancel
            </button>
          </div>
          <p className="gh-state warn" role="status">
            Waiting for you to finish in Google
          </p>
        </div>
      )}
      {[flowNote, google.note, google.error?.message ?? null].map(
        (line, index) =>
          line && (
            <p key={index} className="gh-err" role="alert">
              {line}
            </p>
          ),
      )}
    </>
  );
}
