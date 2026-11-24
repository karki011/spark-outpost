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
import type { CloudCalendar } from './use-cloud-calendar.ts';
import type { CloudProvider } from './calendar-api.ts';
import { outsideTarget } from '../browser/outside-link.ts';

interface ProviderWords {
  name: string;
  calendar: string;
  signIn: string;
  calendarName: string;
}

export const CLOUD_WORDS: Record<CloudProvider, ProviderWords> = {
  google: {
    name: 'Google',
    calendar: 'Google Calendar',
    signIn: 'Sign in with Google',
    calendarName: 'Google calendar',
  },
  microsoft: {
    name: 'Microsoft',
    calendar: 'Microsoft 365 or Outlook.com',
    signIn: 'Sign in with Microsoft',
    calendarName: 'Microsoft calendar',
  },
};

function disconnectCopy(provider: CloudProvider, email: string) {
  const words = CLOUD_WORDS[provider];
  return {
    title: `Disconnect ${email}?`,
    text: `Spark stops showing its meetings and nudges, and signs out of ${words.name}. Your ${words.calendarName} isn’t changed. You can add it back any time.`,
  };
}

const editHint = (provider: CloudProvider) =>
  `${EDIT_HINT} ${CLOUD_WORDS[provider].name} asks you to allow changes the first time.`;

function syncLine(account: GoogleAccountStatus, now: number): string | null {
  if (account.state === 'sign_in_again') return null;
  if (account.syncedAt) return `Synced ${relativeTime(account.syncedAt, now)}`;
  return account.state === 'syncing' ? 'Syncing…' : null;
}

function AccountPill({ account }: { account: GoogleAccountStatus }) {
  if (account.state === 'ready') return <ConnectedPill />;
  if (account.state === 'sign_in_again') return <span className="cal-pill danger">Signed out</span>;
  if (account.state === 'error') return <span className="cal-pill warn">Trying again</span>;
  return <span className="cal-pill">Syncing</span>;
}

interface CloudSourceProps {
  account: GoogleAccountStatus;
  calendars: CalendarAccount | undefined;
  cloud: CloudCalendar;
  onChange: ChangeChoice;
}

export function CloudSource({ account, calendars, cloud, onChange }: CloudSourceProps) {
  const now = useMinuteClock();
  const rows = calendars?.calendars ?? [];
  const signIn = (editCalendar: string | null) =>
    cloud.begin({ accountId: account.id, editCalendar });
  const change = (key: string, patch: CalendarChoicePatch) => {
    if (patch.agentsEdit && !account.canEdit) signIn(key);
    else onChange(key, patch);
  };
  const note = cloud.noteFor === account.id ? cloud.flowNote : null;
  return (
    <SourceCard
      name={account.email}
      icon={<CloudIcon />}
      sync={syncLine(account, now)}
      pill={<AccountPill account={account} />}
      hasCalendars={rows.length > 0}
      startChoosing={rows.every((calendar) => !calendar.include)}
      editHint={editHint(cloud.provider)}
      disconnect={disconnectCopy(cloud.provider, account.email)}
      busy={cloud.busy}
      onDisconnect={() => cloud.remove(account.id)}
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
            disabled={cloud.busy}
            onClick={() => signIn(null)}
          >
            Sign in again
          </button>
        </div>
      )}
    </SourceCard>
  );
}

export function CloudSignInStatus({ cloud }: { cloud: CloudCalendar }) {
  const name = CLOUD_WORDS[cloud.provider].name;
  const asks = cloud.editing ? 'change events in your calendars' : 'see your calendars';
  const flowNote = cloud.noteFor === null ? cloud.flowNote : null;
  return (
    <>
      {cloud.waiting && (
        <div className="cal-google-wait" role="group" aria-label={`${name} sign-in`}>
          <p className="gh-note">
            Finish in your browser: {name} asks you to allow Spark Outpost to {asks}, then sends you
            back here.
          </p>
          <div className="cx-actions">
            {cloud.flow.authorizeUrl && (
              <a
                className="btn line sm"
                href={cloud.flow.authorizeUrl}
                target={outsideTarget()}
                rel="noreferrer"
              >
                Open {name} again
                <ExternalLinkIcon />
              </a>
            )}
            <button type="button" className="btn ghost sm" onClick={cloud.cancel}>
              Cancel
            </button>
          </div>
          <p className="gh-state warn" role="status">
            Waiting for you to finish in {name}
          </p>
        </div>
      )}
      {[flowNote, cloud.note, cloud.error?.message ?? null].map(
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
