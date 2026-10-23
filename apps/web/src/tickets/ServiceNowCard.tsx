import './atlassian-card.css';
import { useId, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SERVICENOW_NAME,
  serviceNowTypeIdSchema,
  serviceNowTypeNames,
  type ServiceNowInboxScope,
  type ServiceNowType,
  type ServiceNowTypeId,
  type TicketConnection,
  type TicketConnections,
  type UpdateTicketSettingsRequest,
} from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { AccountRow } from '../connectors/AccountRow.tsx';
import { ConnectorCard } from '../connectors/ConnectorCard.tsx';
import { SettingRow } from '../settings/SettingRow.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { jiraSiteHost } from './jira-site.ts';
import { TicketConnectForm } from './TicketConnectForm.tsx';
import { ticketKeys, ticketsApi } from './tickets-api.ts';

export const SERVICENOW_DESCRIPTION =
  'Incidents, requests and changes in your tickets inbox, and for agents: search, read and update.';

const TYPE_LINES: Record<ServiceNowTypeId, string> = {
  incident: 'Your inbox, and agents search, read, update, add work notes and comments.',
  request: 'Requested items and catalog tasks assigned to you or your groups.',
  change: 'Read only: agents search and read change requests and don’t change them.',
  problem: 'Your inbox, and agents search, read, update and add work notes.',
};

export const SERVICENOW_DISCONNECT = {
  title: 'Disconnect ServiceNow?',
  text: 'Spark stops showing ServiceNow records, and agents lose the ServiceNow tools. Spark deletes the saved sign-in from your keychain. Nothing changes on your instance.',
};

export function serviceNowLine(connection: TicketConnection): string {
  return `${jiraSiteHost(connection.siteUrl ?? '')} · ${connection.account}`;
}

function typeLine(id: ServiceNowTypeId, type: ServiceNowType): string {
  if (type.reach === 'denied') {
    return `This account can’t read ${serviceNowTypeNames[id].toLowerCase()}.`;
  }
  if (type.reach === 'unchecked') return 'Spark couldn’t check this yet. Check the connection.';
  return TYPE_LINES[id];
}

function useSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateTicketSettingsRequest) =>
      ticketsApi.updateSettings('servicenow', body),
    onSuccess: (connections: TicketConnections) => {
      queryClient.setQueryData(ticketKeys.connections, connections);
      void queryClient.invalidateQueries({ queryKey: ticketKeys.all });
    },
  });
}

function checkLine(save: ReturnType<typeof useSettings>): string {
  if (save.variables?.recheck !== true) return '';
  if (save.isPending) return 'Checking the connection…';
  return save.isSuccess ? 'Connection checked.' : '';
}

function TypeRow({
  id,
  type,
  save,
}: {
  id: ServiceNowTypeId;
  type: ServiceNowType;
  save: ReturnType<typeof useSettings>;
}) {
  const controlId = useId();
  const hintId = useId();
  const name = serviceNowTypeNames[id];
  const wanted = save.isPending ? save.variables.serviceNowTypes?.[id] : undefined;
  return (
    <SettingRow label={name} controlId={controlId} hint={typeLine(id, type)} hintId={hintId}>
      <BlobToggle
        id={controlId}
        label={name}
        checked={wanted ?? type.on}
        describedBy={hintId}
        disabled={save.isPending}
        onChange={(on) => save.mutate({ serviceNowTypes: { [id]: on } })}
      />
    </SettingRow>
  );
}

const SCOPES = [
  { id: 'me', label: 'Assigned to me' },
  { id: 'groups', label: 'Me and my groups' },
];

function InboxScopeRow({
  scope,
  save,
}: {
  scope: ServiceNowInboxScope;
  save: ReturnType<typeof useSettings>;
}) {
  const hintId = useId();
  const wanted = save.isPending ? save.variables.inboxScope : undefined;
  return (
    <SettingRow
      label="Show"
      hint="Records assigned to you, or also those waiting in your groups with nobody assigned. ServiceNow tickets never move when a chat ships or merges."
      hintId={hintId}
    >
      <Segmented
        ariaLabel="Show"
        describedBy={hintId}
        options={SCOPES}
        value={wanted ?? scope}
        onChange={(id) => save.mutate({ inboxScope: id as ServiceNowInboxScope })}
      />
    </SettingRow>
  );
}

function ConnectedBody({ connection }: { connection: TicketConnection }) {
  const queryClient = useQueryClient();
  const save = useSettings();
  const remove = useMutation({
    mutationFn: () => ticketsApi.disconnect('servicenow'),
    onSuccess: (connections) => {
      queryClient.setQueryData(ticketKeys.connections, connections);
      void queryClient.invalidateQueries({ queryKey: ticketKeys.all });
    },
  });
  const types = connection.servicenow?.types;
  const instanceUrl = connection.siteUrl ?? '';
  const error = save.error ?? remove.error;
  return (
    <div className="cx-body at-body">
      <AccountRow
        name={SERVICENOW_NAME}
        place={jiraSiteHost(instanceUrl)}
        account={connection.account}
        items={[
          { label: 'Check connection', onSelect: () => save.mutate({ recheck: true }) },
          {
            label: 'Open instance',
            onSelect: () => window.open(instanceUrl, '_blank', 'noopener,noreferrer'),
          },
        ]}
        disconnectCopy={SERVICENOW_DISCONNECT}
        onDisconnect={() => remove.mutate()}
      />
      <p className="at-status" role="status">
        {checkLine(save)}
      </p>
      {types && (
        <section className="at-products" aria-label="Record types">
          <h4 className="at-sub">Record types</h4>
          {serviceNowTypeIdSchema.options.map((id) => (
            <TypeRow key={id} id={id} type={types[id]} save={save} />
          ))}
        </section>
      )}
      {connection.servicenow && (
        <section className="at-products" aria-label="Tickets inbox">
          <h4 className="at-sub">Tickets inbox</h4>
          <InboxScopeRow scope={connection.servicenow.inboxScope} save={save} />
        </section>
      )}
      {error && (
        <p className="gh-err" role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}

interface ServiceNowCardProps {
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
}

export function ServiceNowCard({ icon, open, onToggle }: ServiceNowCardProps) {
  const status = useQuery({ queryKey: ticketKeys.connections, queryFn: ticketsApi.connections });
  const connection =
    status.data?.connections.find((entry) => entry.source === 'servicenow' && entry.keySaved) ??
    null;
  return (
    <ConnectorCard
      connectorId="servicenow"
      name={SERVICENOW_NAME}
      icon={icon}
      status={connection ? serviceNowLine(connection) : SERVICENOW_DESCRIPTION}
      badge={status.isPending ? 'checking' : connection ? 'connected' : null}
      open={open}
      onToggle={onToggle}
    >
      {status.isError && <p className="gh-err">{status.error.message}</p>}
      {connection ? (
        <ConnectedBody connection={connection} />
      ) : (
        status.isSuccess && (
          <div className="tk-src-body">
            <TicketConnectForm source="servicenow" onConnected={onToggle} onCancel={onToggle} />
          </div>
        )
      )}
    </ConnectorCard>
  );
}
