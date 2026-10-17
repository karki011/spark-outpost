import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GOOGLE_TESTING_LINE,
  type CalendarAccount,
  type CalendarChoicePatch,
  type CalendarStatus,
  type GoogleAccountStatus,
  type GoogleSignInFlow,
} from '@spark-outpost/contracts';
import { ExternalLinkIcon } from '../ui/icons.tsx';
import { CalendarAccounts } from './CalendarAccounts.tsx';
import { calendarApi, calendarKeys } from './calendar-api.ts';
import { CalendarName } from './CalendarName.tsx';

const POLL_MS = 1500;

export const ADD_GOOGLE_LABEL = 'Add Google account';

function useGoogleSignIn(initial: GoogleSignInFlow, enabled: boolean) {
  const queryClient = useQueryClient();
  const flow = useQuery({
    queryKey: calendarKeys.googleSignIn,
    queryFn: calendarApi.googleSignIn,
    initialData: initial,
    enabled,
    refetchInterval: (query) => (query.state.data?.status === 'waiting' ? POLL_MS : false),
  });
  const state = flow.data.status;
  useEffect(() => {
    if (state === 'connected') void queryClient.invalidateQueries({ queryKey: calendarKeys.all });
  }, [state, queryClient]);
  const setFlow = (next: GoogleSignInFlow) =>
    queryClient.setQueryData(calendarKeys.googleSignIn, next);
  const start = useMutation({
    mutationFn: (accountId: string | null) => calendarApi.startGoogleSignIn(accountId),
    onSuccess: (next) => {
      setFlow(next);
      if (next.authorizeUrl) window.open(next.authorizeUrl, '_blank', 'noopener,noreferrer');
    },
  });
  const cancel = useMutation({ mutationFn: calendarApi.cancelGoogleSignIn, onSuccess: setFlow });
  return { flow: flow.data, start, cancel };
}

function useDisconnectGoogle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: calendarApi.disconnectGoogle,
    onSuccess: ({ status }) => {
      queryClient.setQueryData(calendarKeys.status, status);
      void queryClient.invalidateQueries({
        queryKey: calendarKeys.all,
        predicate: (query) => query.queryKey[1] !== 'status',
      });
    },
  });
}

function Waiting({ flow, onCancel }: { flow: GoogleSignInFlow; onCancel: () => void }) {
  return (
    <div className="cal-google-wait" role="group" aria-label="Google sign-in">
      <p className="gh-note">
        Finish in your browser: Google asks you to allow Spark Outpost to see your calendars, then
        sends you back here.
      </p>
      <div className="cx-actions">
        {flow.authorizeUrl && (
          <a className="btn line sm" href={flow.authorizeUrl} target="_blank" rel="noreferrer">
            Open Google again
            <ExternalLinkIcon />
          </a>
        )}
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="gh-state warn" role="status">
        Waiting for you to finish in Google
      </p>
    </div>
  );
}

interface AccountProps {
  account: GoogleAccountStatus;
  calendars: CalendarAccount | undefined;
  busy: boolean;
  onChange: (key: string, patch: CalendarChoicePatch) => void;
  onSignIn: () => void;
  onDisconnect: () => void;
}

function GoogleAccount({
  account,
  calendars,
  busy,
  onChange,
  onSignIn,
  onDisconnect,
}: AccountProps) {
  return (
    <div className="cal-google-acct">
      {calendars && calendars.calendars.length > 0 ? (
        <CalendarAccounts accounts={[calendars]} onChange={onChange} />
      ) : (
        <p className="cal-acct-h">
          <b>
            <CalendarName name={account.email} />
          </b>
          <small>Google</small>
        </p>
      )}
      {account.message && (
        <p className={account.state === 'sign_in_again' ? 'gh-err' : 'gh-state warn'} role="status">
          {account.message}
        </p>
      )}
      <div className="cx-actions">
        {account.state === 'sign_in_again' && (
          <button type="button" className="btn primary sm" disabled={busy} onClick={onSignIn}>
            Sign in again
          </button>
        )}
        <button
          type="button"
          className="btn ghost sm danger"
          aria-label={`Disconnect ${account.email}`}
          disabled={busy}
          onClick={onDisconnect}
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}

interface GoogleAccountsProps {
  status: CalendarStatus;
  accounts: readonly CalendarAccount[];
  onChange: (key: string, patch: CalendarChoicePatch) => void;
}

export function GoogleAccounts({ status, accounts, onChange }: GoogleAccountsProps) {
  const google = status.google;
  const { flow, start, cancel } = useGoogleSignIn(google.signIn, google.available);
  const disconnect = useDisconnectGoogle();
  const [note, setNote] = useState<string | null>(null);
  if (!google.available && google.accounts.length === 0) return null;
  const waiting = flow.status === 'waiting';
  const remove = (accountId: string) => {
    setNote(null);
    disconnect.mutate(accountId, { onSuccess: (result) => setNote(result.message) });
  };
  const error = start.error ?? disconnect.error;
  return (
    <section className="cal-source" aria-labelledby="cal-google-h">
      <h3 id="cal-google-h">Google Calendar</h3>
      <p>
        Read straight from Google, on this Mac. An event that is also in macOS Calendar shows once.
      </p>
      {google.testing && <p className="cal-notice">{GOOGLE_TESTING_LINE}</p>}
      {google.accounts.map((account) => (
        <GoogleAccount
          key={account.id}
          account={account}
          calendars={accounts.find((item) => item.id === `google:${account.id}`)}
          busy={disconnect.isPending || waiting}
          onChange={onChange}
          onSignIn={() => start.mutate(account.id)}
          onDisconnect={() => remove(account.id)}
        />
      ))}
      {waiting && <Waiting flow={flow} onCancel={() => cancel.mutate()} />}
      {flow.status === 'failed' && flow.message && (
        <p className="gh-err" role="alert">
          {flow.message}
        </p>
      )}
      {note && (
        <p className="gh-err" role="alert">
          {note}
        </p>
      )}
      {error && (
        <p className="gh-err" role="alert">
          {error.message}
        </p>
      )}
      {google.available && !waiting && (
        <div className="cx-actions">
          <button
            type="button"
            className="btn line sm"
            disabled={start.isPending}
            onClick={() => start.mutate(null)}
          >
            {ADD_GOOGLE_LABEL}
          </button>
        </div>
      )}
    </section>
  );
}
