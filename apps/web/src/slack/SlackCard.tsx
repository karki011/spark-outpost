import './slack.css';
import '../ship/github-card.css';
import { useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SlackCapabilities, SlackConnection } from '@spark-outpost/contracts';
import { ConnectorCard } from '../connectors/ConnectorCard.tsx';
import { GracePeriodBar } from '../ui/GracePeriodBar.tsx';
import { SlackChannels } from './SlackChannels.tsx';
import { SlackConnectForm } from './SlackConnectForm.tsx';
import { SlackConnectMethods } from './SlackConnectMethods.tsx';
import { SlackDirectMessages } from './SlackDirectMessages.tsx';
import { SlackNotifySettings } from './SlackNotifySettings.tsx';
import { SIGN_IN_SUMMARY, SlackSignInPanel } from './SlackSignIn.tsx';
import { SlackStartSettings } from './SlackStartSettings.tsx';
import { slackApi, slackKeys } from './slack-api.ts';
import { useSlackSave } from './use-slack-save.ts';

const GRACE_SECONDS = 5;

export const SLACK_DESCRIPTION =
  'Get notified, share threads as context, start work from a thread and post updates.';

interface CapabilityLine {
  key: keyof SlackCapabilities;
  on: string;
  off: string;
}

const OWN_APP_CAPABILITIES: CapabilityLine[] = [
  {
    key: 'notify',
    on: 'Notifies you in Slack',
    off: 'Notifications need your member ID or a channel',
  },
  { key: 'readThreads', on: 'Reads threads you share from allowed channels', off: '' },
  {
    key: 'readUnjoined',
    on: 'Reads allowed channels the app has not joined',
    off: 'Reading channels the app has not joined needs a user token',
  },
  { key: 'search', on: 'Agents can search allowed channels', off: 'Search needs a user token' },
  {
    key: 'readDirectMessages',
    on: 'Reads the direct messages you allowed',
    off: 'Direct messages are not read',
  },
  { key: 'post', on: 'Posts updates you confirm', off: '' },
  {
    key: 'startFromSlack',
    on: 'Starts work from the Slack shortcut and @mentions',
    off: 'Starting work inside Slack needs an app-level token',
  },
];

const SIGN_IN_CAPABILITIES: CapabilityLine[] = [
  { key: 'notify', on: 'Notifies you with a message to yourself', off: '' },
  { key: 'readThreads', on: 'Reads threads you share from allowed channels, as you', off: '' },
  { key: 'search', on: 'Agents can search allowed channels', off: '' },
  {
    key: 'readDirectMessages',
    on: 'Reads the direct messages you allowed',
    off: 'Direct messages are not read',
  },
  { key: 'post', on: 'Posts updates as you, always after you confirm', off: '' },
  {
    key: 'startFromSlack',
    on: '',
    off: 'Starting work inside Slack needs your own Slack app',
  },
];

function Capabilities({ connection }: { connection: SlackConnection }) {
  const lines = connection.method === 'sign_in' ? SIGN_IN_CAPABILITIES : OWN_APP_CAPABILITIES;
  return (
    <ul className="sl-caps" aria-label="What Slack can do">
      {lines.map((item) => (
        <li
          key={item.key}
          className={connection.capabilities[item.key] ? 'gh-state ok' : 'gh-state'}
        >
          {connection.capabilities[item.key] ? item.on : item.off}
        </li>
      ))}
    </ul>
  );
}

type Change = 'tokens' | 'own_app' | 'sign_in' | null;

function ChangeMethod({
  change,
  connection,
  onDone,
}: {
  change: Exclude<Change, null>;
  connection: SlackConnection;
  onDone: () => void;
}) {
  const keep =
    connection.method === 'sign_in' ? 'Keep my Slack sign-in' : 'Keep the current tokens';
  return (
    <div className="cx-body">
      {change === 'sign_in' ? (
        <>
          <p className="tk-field-help">{SIGN_IN_SUMMARY}</p>
          <SlackSignInPanel switching autoFocus />
        </>
      ) : (
        <SlackConnectForm onConnected={onDone} replacesSignIn={change === 'own_app'} />
      )}
      <div className="cx-actions">
        <button type="button" className="btn ghost sm" onClick={onDone}>
          {keep}
        </button>
      </div>
    </div>
  );
}

function SignInEnded({ connection }: { connection: SlackConnection }) {
  return (
    <div className="sl-update" role="group" aria-label="Slack sign-in ended">
      <p className="sl-problem" role="status">
        Your Slack sign-in ended. Slack ends one after 30 days without use, or when access is
        removed. Nothing is read or sent until you sign in again; your allowed channels are kept.
      </p>
      <SlackSignInPanel
        label="Sign in again"
        directMessages={connection.settings.readDirectMessages}
      />
    </div>
  );
}

function ConnectedBody({
  connection,
  signInAvailable,
  onClose,
}: {
  connection: SlackConnection;
  signInAvailable: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const save = useSlackSave();
  const [leaving, setLeaving] = useState(false);
  const [change, setChange] = useState<Change>(null);
  const remove = useMutation({
    mutationFn: slackApi.disconnect,
    onSuccess: (status) => queryClient.setQueryData(slackKeys.status, status),
  });
  const signedIn = connection.method === 'sign_in';
  const usable = connection.state === 'connected';
  const activeChange = change === 'sign_in' && signedIn ? null : change;
  if (activeChange) {
    return (
      <ChangeMethod change={activeChange} connection={connection} onDone={() => setChange(null)} />
    );
  }
  return (
    <div className="cx-body">
      <p>{SLACK_DESCRIPTION}</p>
      {usable ? <Capabilities connection={connection} /> : <SignInEnded connection={connection} />}
      {connection.lastProblem && (
        <p className="sl-problem" role="status">
          Last problem: {connection.lastProblem.message}
        </p>
      )}
      {save.error && (
        <p className="gh-err" role="alert">
          {save.error}
        </p>
      )}
      {usable && (
        <>
          <SlackChannels connection={connection} save={save} />
          <SlackDirectMessages connection={connection} save={save} />
          <SlackNotifySettings connection={connection} save={save} />
          <SlackStartSettings
            connection={connection}
            save={save}
            onStarted={onClose}
            onUseOwnApp={() => setChange('own_app')}
          />
        </>
      )}
      {remove.isError && (
        <p className="gh-err" role="alert">
          {remove.error.message}
        </p>
      )}
      <div className="cx-actions">
        {signedIn ? (
          <button type="button" className="btn line sm" onClick={() => setChange('own_app')}>
            Use your own Slack app
          </button>
        ) : (
          <>
            <button type="button" className="btn line sm" onClick={() => setChange('tokens')}>
              Change tokens
            </button>
            {signInAvailable && (
              <button type="button" className="btn line sm" onClick={() => setChange('sign_in')}>
                Sign in with Slack instead
              </button>
            )}
          </>
        )}
        <button
          type="button"
          className="btn ghost sm danger"
          onClick={() => setLeaving(true)}
          disabled={leaving || remove.isPending}
        >
          Disconnect
        </button>
      </div>
      <AnimatePresence>
        {leaving && (
          <GracePeriodBar
            key="grace"
            text="Disconnecting Slack…"
            announcement={`Slack disconnects in ${GRACE_SECONDS} seconds. Press Undo or Escape to keep it.`}
            seconds={GRACE_SECONDS}
            onElapse={() => {
              setLeaving(false);
              remove.mutate();
            }}
            onUndo={() => setLeaving(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function statusLine(connection: SlackConnection): string {
  if (connection.state === 'needs_sign_in') return `Sign in again to use ${connection.team}`;
  const who = connection.method === 'sign_in' ? connection.member?.name : connection.botName;
  return `Connected to ${connection.team} as ${who ?? 'you'}`;
}

export function SlackCard({
  icon,
  open,
  onToggle,
}: {
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  const status = useQuery({ queryKey: slackKeys.status, queryFn: slackApi.status });
  const connection = status.data?.connection ?? null;
  const line = connection ? statusLine(connection) : SLACK_DESCRIPTION;
  const signInAvailable = status.data?.signInAvailable ?? false;
  return (
    <ConnectorCard
      connectorId="slack"
      name="Slack"
      icon={icon}
      status={line}
      badge={status.isPending ? 'checking' : connection?.state === 'connected' ? 'connected' : null}
      open={open}
      onToggle={onToggle}
    >
      {status.isError && <p className="gh-err">{status.error.message}</p>}
      {connection ? (
        <ConnectedBody
          connection={connection}
          signInAvailable={signInAvailable}
          onClose={onToggle}
        />
      ) : (
        status.isSuccess && (
          <div className="tk-src-body">
            <SlackConnectMethods signInAvailable={signInAvailable} />
          </div>
        )
      )}
    </ConnectorCard>
  );
}
