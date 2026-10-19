import '../ship/github-card.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  ticketSourceNames,
  type TicketConnection,
  type TicketConnections,
  type TicketSourceId,
} from '@spark-outpost/contracts';
import { ConnectorCard } from '../connectors/ConnectorCard.tsx';
import { GracePeriodBar } from '../ui/GracePeriodBar.tsx';
import { jiraSiteHost } from './jira-site.ts';
import { TicketConnectForm } from './TicketConnectForm.tsx';
import { TicketSyncSettings } from './TicketSyncSettings.tsx';
import { ticketKeys, ticketsApi } from './tickets-api.ts';

const GRACE_SECONDS = 5;

interface TicketSourceCardProps {
  source: Exclude<TicketSourceId, 'jira'>;
  icon: ReactNode;
  description: string;
  open: boolean;
  onToggle: () => void;
}

export function whereLine(connection: TicketConnection): string {
  const place = connection.siteUrl
    ? jiraSiteHost(connection.siteUrl)
    : ticketSourceNames[connection.source];
  return `Connected to ${place} as ${connection.account}`;
}

function disconnected(queryClient: QueryClient, connections: TicketConnections): void {
  queryClient.setQueryData(ticketKeys.connections, connections);
  void queryClient.invalidateQueries({ queryKey: ticketKeys.all });
}

function useGracefulDisconnect(source: TicketSourceId) {
  const queryClient = useQueryClient();
  const [waiting, setWaiting] = useState(false);
  const waitingRef = useRef(false);
  const remove = useMutation({
    mutationFn: () => ticketsApi.disconnect(source),
    onSuccess: (connections) => disconnected(queryClient, connections),
  });

  useEffect(() => {
    waitingRef.current = waiting;
  }, [waiting]);

  useEffect(
    () => () => {
      if (!waitingRef.current) return;
      void ticketsApi
        .disconnect(source)
        .then((connections) => disconnected(queryClient, connections));
    },
    [source, queryClient],
  );

  return {
    waiting,
    pending: waiting || remove.isPending,
    error: remove.error?.message ?? null,
    start: () => {
      remove.reset();
      setWaiting(true);
    },
    undo: () => setWaiting(false),
    commit: () => {
      waitingRef.current = false;
      setWaiting(false);
      remove.mutate();
    },
  };
}

function ConnectedBody({
  description,
  leave,
  name,
  connection,
}: {
  description: string;
  leave: ReturnType<typeof useGracefulDisconnect>;
  name: string;
  connection: TicketConnection;
}) {
  return (
    <div className="cx-body">
      <p>{description}</p>
      <TicketSyncSettings connection={connection} />
      {leave.error && (
        <p className="gh-err" role="alert">
          {leave.error}
        </p>
      )}
      <div className="cx-actions">
        <button
          type="button"
          className="btn ghost sm danger"
          onClick={leave.start}
          disabled={leave.pending}
        >
          Disconnect
        </button>
      </div>
      <AnimatePresence>
        {leave.waiting && (
          <GracePeriodBar
            key="grace"
            text={`Disconnecting ${name}…`}
            announcement={`${name} disconnects in ${GRACE_SECONDS} seconds. Press Undo or Escape to keep it.`}
            seconds={GRACE_SECONDS}
            onElapse={leave.commit}
            onUndo={leave.undo}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export function TicketSourceCard({
  source,
  icon,
  description,
  open,
  onToggle,
}: TicketSourceCardProps) {
  const status = useQuery({ queryKey: ticketKeys.connections, queryFn: ticketsApi.connections });
  const leave = useGracefulDisconnect(source);
  const name = ticketSourceNames[source];
  const connection =
    status.data?.connections.find((entry) => entry.source === source && entry.keySaved) ?? null;
  const statusLine = leave.pending
    ? `Disconnecting ${name}…`
    : connection
      ? whereLine(connection)
      : description;

  return (
    <ConnectorCard
      connectorId={source}
      name={name}
      icon={icon}
      status={statusLine}
      badge={status.isPending ? 'checking' : connection ? 'connected' : null}
      open={open}
      onToggle={onToggle}
    >
      {status.isError && <p className="gh-err">{status.error.message}</p>}
      {connection ? (
        <ConnectedBody
          description={description}
          leave={leave}
          name={name}
          connection={connection}
        />
      ) : (
        status.isSuccess && (
          <div className="tk-src-body">
            <TicketConnectForm source={source} onConnected={onToggle} onCancel={onToggle} />
          </div>
        )
      )}
    </ConnectorCard>
  );
}
