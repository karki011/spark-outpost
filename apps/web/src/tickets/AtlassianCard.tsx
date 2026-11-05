import './atlassian-card.css';
import { useId, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ATLASSIAN_NAME,
  atlassianProductNames,
  type AtlassianProduct,
  type AtlassianProductId,
  type TicketConnection,
  type TicketConnections,
  type UpdateTicketSettingsRequest,
} from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { AccountRow } from '../connectors/AccountRow.tsx';
import { ConnectorCard } from '../connectors/ConnectorCard.tsx';
import { SettingRow } from '../settings/SettingRow.tsx';
import { jiraSiteHost } from './jira-site.ts';
import { TicketConnectForm } from './TicketConnectForm.tsx';
import { TicketSyncSettings } from './TicketSyncSettings.tsx';
import { ticketKeys, ticketsApi } from './tickets-api.ts';

export const ATLASSIAN_DESCRIPTION =
  'Jira tickets in your inbox, and Jira and Confluence for agents: search, read, create, change and delete.';

const PRODUCT_LINES: Record<AtlassianProductId, string> = {
  jira: 'Your tickets inbox, and agents search, read, create, change and delete issues.',
  confluence: 'Agents search, read, create, change and comment on pages.',
};

const DENIED_LINES: Record<AtlassianProductId, string> = {
  jira: 'This token can’t reach Jira on this site. Use a token that includes Jira and connect again.',
  confluence:
    'This token can’t reach Confluence on this site. Use a token that includes Confluence and connect again.',
};

export const ATLASSIAN_DISCONNECT = {
  title: 'Disconnect Atlassian?',
  text: 'Spark stops showing Jira tickets, and agents lose the Jira and Confluence tools. Spark deletes the saved token from your keychain. Nothing changes on your Atlassian site.',
};

export function atlassianLine(connection: TicketConnection): string {
  return `${jiraSiteHost(connection.siteUrl ?? '')} · ${connection.account}`;
}

function productLine(id: AtlassianProductId, product: AtlassianProduct): string {
  if (product.reach === 'denied') return DENIED_LINES[id];
  if (product.reach === 'unchecked') return 'Spark checks whether this token reaches it.';
  return PRODUCT_LINES[id];
}

function useProductSwitch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateTicketSettingsRequest) => ticketsApi.updateSettings('jira', body),
    onSuccess: (connections: TicketConnections) => {
      queryClient.setQueryData(ticketKeys.connections, connections);
      void queryClient.invalidateQueries({ queryKey: ticketKeys.all });
    },
  });
}

function ProductRow({
  id,
  product,
  save,
}: {
  id: AtlassianProductId;
  product: AtlassianProduct;
  save: ReturnType<typeof useProductSwitch>;
}) {
  const controlId = useId();
  const hintId = useId();
  const name = atlassianProductNames[id];
  const key = id === 'jira' ? 'jiraOn' : 'confluenceOn';
  const wanted = save.isPending ? save.variables[key] : undefined;
  const checked = wanted ?? product.on;
  return (
    <SettingRow label={name} controlId={controlId} hint={productLine(id, product)} hintId={hintId}>
      <BlobToggle
        id={controlId}
        label={name}
        checked={checked}
        describedBy={hintId}
        disabled={save.isPending}
        onChange={(on) => save.mutate(id === 'jira' ? { jiraOn: on } : { confluenceOn: on })}
      />
    </SettingRow>
  );
}

function ConnectedBody({ connection }: { connection: TicketConnection }) {
  const queryClient = useQueryClient();
  const save = useProductSwitch();
  const remove = useMutation({
    mutationFn: () => ticketsApi.disconnect('jira'),
    onSuccess: (connections) => {
      queryClient.setQueryData(ticketKeys.connections, connections);
      void queryClient.invalidateQueries({ queryKey: ticketKeys.all });
    },
  });
  const products = connection.atlassian;
  const jiraOn = products?.jira.on === true && products.jira.reach === 'reachable';
  const error = save.error ?? remove.error;
  return (
    <div className="cx-body at-body">
      <AccountRow
        name={ATLASSIAN_NAME}
        place={jiraSiteHost(connection.siteUrl ?? '')}
        account={connection.account}
        disconnectCopy={ATLASSIAN_DISCONNECT}
        onDisconnect={() => remove.mutate()}
      />
      {products && (
        <div className="at-products" role="group" aria-label="Products">
          <ProductRow id="jira" product={products.jira} save={save} />
          <ProductRow id="confluence" product={products.confluence} save={save} />
        </div>
      )}
      {error && (
        <p className="gh-err" role="alert">
          {error.message}
        </p>
      )}
      {jiraOn && (
        <section className="at-tickets" aria-label="Jira tickets">
          <h4 className="at-sub">Jira tickets</h4>
          <TicketSyncSettings connection={connection} />
        </section>
      )}
    </div>
  );
}

interface AtlassianCardProps {
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
}

export function AtlassianCard({ icon, open, onToggle }: AtlassianCardProps) {
  const status = useQuery({ queryKey: ticketKeys.connections, queryFn: ticketsApi.connections });
  const connection =
    status.data?.connections.find((entry) => entry.source === 'jira' && entry.keySaved) ?? null;
  return (
    <ConnectorCard
      connectorId="atlassian"
      name={ATLASSIAN_NAME}
      icon={icon}
      status={connection ? atlassianLine(connection) : ATLASSIAN_DESCRIPTION}
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
            <TicketConnectForm source="jira" onConnected={onToggle} onCancel={onToggle} />
          </div>
        )
      )}
    </ConnectorCard>
  );
}
