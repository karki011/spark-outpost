import '../ship/github-card.css';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  ticketSourceNames,
  type TicketConnection,
  type TicketConnections,
  type TicketSourceId,
} from '@spark-outpost/contracts';
import { GracePeriodBar } from '../ui/GracePeriodBar.tsx';
import { ChevronIcon } from '../ui/icons.tsx';
import { fadeReveal, useExpandReveal } from '../ui/transitions.tsx';
import { jiraSiteHost } from './jira-site.ts';
import { TicketConnectForm } from './TicketConnectForm.tsx';
import { TicketSyncSettings } from './TicketSyncSettings.tsx';
import { ticketKeys, ticketsApi } from './tickets-api.ts';

const GRACE_SECONDS = 5;

interface TicketSourceCardProps {
  source: TicketSourceId;
  icon: ReactNode;
  description: string;
  primary?: boolean;
}

function whereLine(connection: TicketConnection): string {
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

function ConnectedSummary({ connection }: { connection: TicketConnection }) {
  const name = ticketSourceNames[connection.source];
  const settingsId = useId();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const leave = useGracefulDisconnect(connection.source);
  return (
    <div className="tk-src-connected">
      <div className="gh-summary">
        <p className="gh-active">
          {leave.pending ? `Disconnecting ${name}…` : whereLine(connection)}
        </p>
        <span className="tk-src-acts">
          <button
            type="button"
            className="gh-disclose"
            aria-expanded={settingsOpen}
            aria-controls={settingsId}
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            Ticket updates
            <ChevronIcon />
          </button>
          <button
            type="button"
            className="btn ghost sm danger"
            onClick={leave.start}
            disabled={leave.pending}
          >
            Disconnect
          </button>
        </span>
      </div>
      {leave.error && (
        <p className="gh-err" role="alert">
          {leave.error}
        </p>
      )}
      <AnimatePresence initial={false}>
        {settingsOpen && (
          <motion.div key="settings" id={settingsId} className="gh-collapse" {...fadeReveal}>
            <TicketSyncSettings connection={connection} />
          </motion.div>
        )}
      </AnimatePresence>
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

export function TicketSourceCard({ source, icon, description, primary }: TicketSourceCardProps) {
  const connectRef = useRef<HTMLButtonElement>(null);
  const [connecting, setConnecting] = useState(false);
  const expand = useExpandReveal();
  const status = useQuery({ queryKey: ticketKeys.connections, queryFn: ticketsApi.connections });
  const name = ticketSourceNames[source];
  const connection =
    status.data?.connections.find((entry) => entry.source === source && entry.keySaved) ?? null;
  const summaryShown = connection !== null && !connecting;
  const cancel = () => {
    setConnecting(false);
    requestAnimationFrame(() => connectRef.current?.focus());
  };

  return (
    <li className={connecting ? 'ccard tk-src open' : 'ccard tk-src'} data-source={source}>
      <div className="top">
        <span className="plogo">{icon}</span>
        <b>{name}</b>
        {connection && <span className="gh-badge on">Connected</span>}
        {status.isPending && <span className="tk-src-sk" aria-hidden="true" />}
        {status.isSuccess && !connection && !connecting && (
          <button
            ref={connectRef}
            type="button"
            className={primary ? 'btn primary sm' : 'btn line sm'}
            onClick={() => setConnecting(true)}
          >
            Connect
          </button>
        )}
      </div>
      <p>{description}</p>
      {status.isError && <p className="gh-err">{status.error.message}</p>}
      <AnimatePresence initial={false} mode="wait">
        {connecting && (
          <motion.div key="form" className="gh-collapse" {...expand}>
            <div className="tk-src-body">
              <TicketConnectForm
                source={source}
                onConnected={() => setConnecting(false)}
                onCancel={cancel}
              />
            </div>
          </motion.div>
        )}
        {summaryShown && (
          <motion.div key="summary" className="gh-collapse" {...expand}>
            <ConnectedSummary connection={connection} />
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}
