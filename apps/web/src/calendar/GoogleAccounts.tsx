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
import { CalendarRows, RowsHeader } from './CalendarAccounts.tsx';
import { calendarApi, calendarKeys, type GoogleSignInStart } from './calendar-api.ts';
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
    mutationFn: (request: GoogleSignInStart) => calendarApi.startGoogleSignIn(request),
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

interface WaitingProps {
  flow: GoogleSignInFlow;
  editing: boolean;
  onCancel: () => void;
}

function Waiting({ flow, editing, onCancel }: WaitingProps) {
  const asks = editing ? 'change events in your calendars' : 'see your calendars';
  return (
    <div className="cal-google-wait" role="group" aria-label="Google sign-in">
      <p className="gh-note">
        Finish in your browser: Google asks you to allow Spark Outpost to {asks}, then sends you
        back here.
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
  note: string | null;
  onChange: (key: string, patch: CalendarChoicePatch) => void;
  onSignIn: (editCalendar: string | null) => void;
  onDisconnect: () => void;
}

function GoogleAccount({
  account,
  calendars,
  busy,
  note,
  onChange,
  onSignIn,
  onDisconnect,
}: AccountProps) {
  const rows = calendars?.calendars ?? [];
  const change = (key: string, patch: CalendarChoicePatch) => {
    if (patch.agentsEdit && !account.canEdit) onSignIn(key);
    else onChange(key, patch);
  };
  return (
    <section className="cal-source" aria-label={account.email}>
      <div className="cal-src-h">
        <h3>Google</h3>
        <small>
          <CalendarName name={account.email} />
        </small>
      </div>
      {rows.length > 0 && (
        <>
          <RowsHeader withEdit />
          <CalendarRows calendars={rows} onChange={change} withEdit />
        </>
      )}
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
      <div className="cal-foot">
        {account.state === 'sign_in_again' && (
          <button
            type="button"
            className="btn primary sm"
            disabled={busy}
            onClick={() => onSignIn(null)}
          >
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
    </section>
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
  const [started, setStarted] = useState<GoogleSignInStart | null>(null);
  if (!google.available && google.accounts.length === 0) return null;
  const waiting = flow.status === 'waiting';
  const begin = (request: GoogleSignInStart) => {
    setStarted(request);
    start.mutate(request);
  };
  const flowNote = waiting ? null : flow.message;
  const noteFor = started?.accountId ?? null;
  const remove = (accountId: string) => {
    setNote(null);
    disconnect.mutate(accountId, { onSuccess: (result) => setNote(result.message) });
  };
  const error = start.error ?? disconnect.error;
  return (
    <>
      {google.accounts.map((account) => (
        <GoogleAccount
          key={account.id}
          account={account}
          calendars={accounts.find((item) => item.id === `google:${account.id}`)}
          busy={disconnect.isPending || waiting}
          note={noteFor === account.id ? flowNote : null}
          onChange={onChange}
          onSignIn={(editCalendar) => begin({ accountId: account.id, editCalendar })}
          onDisconnect={() => remove(account.id)}
        />
      ))}
      <section className="cal-source" aria-label="Google Calendar">
        {google.accounts.length === 0 && (
          <div className="cal-src-h">
            <h3>Google Calendar</h3>
            <small>Read straight from Google</small>
          </div>
        )}
        {waiting && (
          <Waiting
            flow={flow}
            editing={Boolean(started?.editCalendar)}
            onCancel={() => cancel.mutate()}
          />
        )}
        {flowNote && noteFor === null && (
          <p className="gh-err" role="alert">
            {flowNote}
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
          <div className="cal-foot">
            {google.testing && <p className="cal-muted">{GOOGLE_TESTING_LINE}</p>}
            <button
              type="button"
              className="btn line sm"
              disabled={start.isPending}
              onClick={() => begin({ accountId: null, editCalendar: null })}
            >
              {ADD_GOOGLE_LABEL}
            </button>
          </div>
        )}
      </section>
    </>
  );
}
