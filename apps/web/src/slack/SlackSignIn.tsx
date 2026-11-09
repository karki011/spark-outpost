import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SlackSignInFlow } from '@spark-outpost/contracts';
import { ExternalLinkIcon } from '../ui/icons.tsx';
import { slackApi, slackKeys } from './slack-api.ts';
import { openOutside } from '../browser/outside-link.ts';

const POLL_MS = 2000;

export const SIGN_IN_SUMMARY =
  'Approve Spark in your browser. Spark reads the threads you share and posts what you confirm, as you. No app to create, no tokens to paste.';
export const OWN_APP_SUMMARY =
  'Adds a Spark bot: start work from inside Slack with @Spark or the message shortcut, and posts come from the app, not from you. You create the app and paste its tokens.';

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function useSlackSignInFlow(): SlackSignInFlow | undefined {
  const queryClient = useQueryClient();
  const flow = useQuery({
    queryKey: slackKeys.signIn,
    queryFn: slackApi.signIn,
    refetchInterval: (query) => (query.state.data?.status === 'waiting' ? POLL_MS : false),
  });
  const status = flow.data?.status;
  useEffect(() => {
    if (status !== 'connected') return;
    void queryClient.invalidateQueries({ queryKey: slackKeys.status });
    void queryClient.invalidateQueries({ queryKey: slackKeys.directMessages });
  }, [status, queryClient]);
  return flow.data;
}

function Waiting({
  flow,
  cancelling,
  onCancel,
}: {
  flow: SlackSignInFlow;
  cancelling: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="sl-signin" role="group" aria-label="Slack sign-in">
      <p className="gh-note">
        Finish in your browser: Slack asks you to allow Spark Outpost, then brings you back here.
      </p>
      <div className="gh-actions">
        {flow.authorizeUrl && (
          <a className="btn line sm" href={flow.authorizeUrl} target="_blank" rel="noreferrer">
            Open Slack again
            <ExternalLinkIcon />
          </a>
        )}
        <button type="button" className="btn ghost sm" onClick={onCancel} disabled={cancelling}>
          Cancel
        </button>
      </div>
      <p className="gh-state warn" role="status">
        Waiting for you to finish in Slack
        {flow.expiresAt ? ` · until ${clock(flow.expiresAt)}` : ''}
      </p>
    </div>
  );
}

export function SlackSignInPanel({
  label = 'Sign in with Slack',
  switching = false,
  directMessages = false,
  autoFocus = false,
}: {
  label?: string;
  switching?: boolean;
  directMessages?: boolean;
  autoFocus?: boolean;
}) {
  const queryClient = useQueryClient();
  const flow = useSlackSignInFlow();
  const [confirming, setConfirming] = useState(false);
  const setFlow = (next: SlackSignInFlow) => queryClient.setQueryData(slackKeys.signIn, next);
  const start = useMutation({
    mutationFn: () => slackApi.startSignIn({ directMessages, replace: switching }),
    onSuccess: (next) => {
      setFlow(next);
      setConfirming(false);
      if (next.authorizeUrl) openOutside(next.authorizeUrl);
    },
  });
  const cancel = useMutation({ mutationFn: slackApi.cancelSignIn, onSuccess: setFlow });

  if (flow?.status === 'waiting') {
    return <Waiting flow={flow} cancelling={cancel.isPending} onCancel={() => cancel.mutate()} />;
  }
  const problem = start.isError
    ? start.error.message
    : flow?.status === 'failed'
      ? flow.message
      : null;
  if (confirming) {
    return (
      <div className="sl-signin" role="group" aria-label="Switch to Slack sign-in">
        <p className="gh-note">
          Once you are signed in, Spark removes your Slack app&rsquo;s tokens from this Mac.
          Starting work from inside Slack stops and posts come from you. Your allowed channels stay.
        </p>
        <div className="gh-actions">
          <button
            type="button"
            className="btn primary sm"
            onClick={() => start.mutate()}
            disabled={start.isPending}
            autoFocus
          >
            Switch and sign in
          </button>
          <button type="button" className="btn ghost sm" onClick={() => setConfirming(false)}>
            Keep my Slack app
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="sl-signin">
      {problem && (
        <p className="gh-err" role="alert">
          {problem}
        </p>
      )}
      <div className="gh-actions">
        <button
          type="button"
          className="btn primary sm"
          onClick={() => (switching ? setConfirming(true) : start.mutate())}
          disabled={start.isPending}
          autoFocus={autoFocus}
        >
          {start.isPending ? 'Opening Slack…' : label}
        </button>
      </div>
    </div>
  );
}
