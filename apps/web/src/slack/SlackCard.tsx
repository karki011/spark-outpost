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
import { SlackNotifySettings } from './SlackNotifySettings.tsx';
import { SlackStartSettings } from './SlackStartSettings.tsx';
import { slackApi, slackKeys } from './slack-api.ts';
import { useSlackSave } from './use-slack-save.ts';

const GRACE_SECONDS = 5;

export const SLACK_DESCRIPTION =
  'Get notified, share threads as context, start work from a thread and post updates.';

const CAPABILITIES: { key: keyof SlackCapabilities; on: string; off: string }[] = [
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
  { key: 'post', on: 'Posts updates you confirm', off: '' },
  {
    key: 'startFromSlack',
    on: 'Starts work from the Slack shortcut and @mentions',
    off: 'Starting work inside Slack needs an app-level token',
  },
];

function Capabilities({ capabilities }: { capabilities: SlackCapabilities }) {
  return (
    <ul className="sl-caps" aria-label="What Slack can do">
      {CAPABILITIES.map((item) => (
        <li key={item.key} className={capabilities[item.key] ? 'gh-state ok' : 'gh-state'}>
          {capabilities[item.key] ? item.on : item.off}
        </li>
      ))}
    </ul>
  );
}

function ConnectedBody({
  connection,
  onClose,
}: {
  connection: SlackConnection;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const save = useSlackSave();
  const [leaving, setLeaving] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const remove = useMutation({
    mutationFn: slackApi.disconnect,
    onSuccess: (status) => queryClient.setQueryData(slackKeys.status, status),
  });
  if (replacing) {
    return (
      <div className="cx-body">
        <SlackConnectForm onConnected={() => setReplacing(false)} />
        <div className="cx-actions">
          <button type="button" className="btn ghost sm" onClick={() => setReplacing(false)}>
            Keep the current tokens
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="cx-body">
      <p>{SLACK_DESCRIPTION}</p>
      <Capabilities capabilities={connection.capabilities} />
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
      <SlackChannels connection={connection} save={save} />
      <SlackNotifySettings connection={connection} save={save} />
      <SlackStartSettings connection={connection} save={save} onStarted={onClose} />
      {remove.isError && (
        <p className="gh-err" role="alert">
          {remove.error.message}
        </p>
      )}
      <div className="cx-actions">
        <button type="button" className="btn line sm" onClick={() => setReplacing(true)}>
          Change tokens
        </button>
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
  const line = connection
    ? `Connected to ${connection.team} as ${connection.botName}`
    : SLACK_DESCRIPTION;
  return (
    <ConnectorCard
      connectorId="slack"
      name="Slack"
      icon={icon}
      status={line}
      badge={status.isPending ? 'checking' : connection ? 'connected' : null}
      open={open}
      onToggle={onToggle}
    >
      {status.isError && <p className="gh-err">{status.error.message}</p>}
      {connection ? (
        <ConnectedBody connection={connection} onClose={onToggle} />
      ) : (
        status.isSuccess && (
          <div className="tk-src-body">
            <SlackConnectForm />
          </div>
        )
      )}
    </ConnectorCard>
  );
}
