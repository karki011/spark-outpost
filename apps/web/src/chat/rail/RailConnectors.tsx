import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { AgentConnector, AgentConnectorId } from '@spark-outpost/contracts';
import { agentConnectorsKey, fetchAgentConnectors } from '../../api/agent-connectors.ts';
import { requestSettings } from '../../settings/settings-request.ts';
import { shipKeys } from '../../ship/ship-api.ts';
import { slackKeys } from '../../slack/slack-api.ts';

interface ConnectorFacts {
  name: string;
  gives: string;
  switchOff?: string;
  action?: string;
}

const CONNECTORS: Record<AgentConnectorId, ConnectorFacts> = {
  github: { name: 'GitHub', gives: 'Pull requests and repos' },
  jira: {
    name: 'Jira',
    gives: 'Search, read and edit issues',
    switchOff: 'Off on the Atlassian card',
  },
  confluence: {
    name: 'Confluence',
    gives: 'Search, read and edit pages',
    switchOff: 'Off on the Atlassian card',
  },
  linear: { name: 'Linear', gives: 'Read, comment on and move tickets' },
  servicenow: {
    name: 'ServiceNow',
    gives: 'Incidents, requests and changes',
    switchOff: 'No record types turned on',
  },
  slack: {
    name: 'Slack',
    gives: 'Read and post messages',
    switchOff: 'Sign-in expired',
    action: 'Sign in',
  },
  calendar: {
    name: 'Calendar',
    gives: 'Read your calendar',
    switchOff: 'Let agents read my calendar is off',
  },
};

const openConnectors = () => requestSettings('tools');

const CONNECTION_KEYS: readonly QueryKey[] = [slackKeys.status, shipKeys.github];

function sameKey(a: QueryKey, b: QueryKey): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}

function useConnectorRefresh(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'success') return;
        if (!CONNECTION_KEYS.some((key) => sameKey(key, event.query.queryKey))) return;
        void queryClient.invalidateQueries({ queryKey: agentConnectorsKey });
      }),
    [queryClient],
  );
}

function ConnectorRow({ connector }: { connector: AgentConnector }) {
  const facts = CONNECTORS[connector.id];
  const on = connector.state === 'on';
  const note = on ? facts.gives : (facts.switchOff ?? 'Off');
  return (
    <li data-state={connector.state}>
      <span className="mcppop-text">
        <code>{facts.name}</code>
        <small title={note}>{note}</small>
      </span>
      {on ? (
        <span className="crail-state on">On</span>
      ) : (
        <button
          type="button"
          className="crail-manage"
          aria-label={
            facts.action ? `${facts.action} to ${facts.name}` : `Turn on ${facts.name} for agents`
          }
          onClick={openConnectors}
        >
          {facts.action ?? 'Turn on'}
        </button>
      )}
    </li>
  );
}

export function RailConnectors() {
  useConnectorRefresh();
  const query = useQuery({ queryKey: agentConnectorsKey, queryFn: fetchAgentConnectors });
  if (!query.data) return null;
  const shown = query.data.connectors.filter((entry) => entry.state !== 'not_connected');
  const missing = query.data.connectors.filter((entry) => entry.state === 'not_connected');
  return (
    <div className="crail-tool-group">
      <h4 className="crail-sub">
        Connectors <span>every chat</span>
      </h4>
      {shown.length > 0 && (
        <ul aria-label="Connectors">
          {shown.map((connector) => (
            <ConnectorRow key={connector.id} connector={connector} />
          ))}
        </ul>
      )}
      {missing.length > 0 && (
        <p className="crail-empty">
          Not connected: {missing.map((entry) => CONNECTORS[entry.id].name).join(', ')}.{' '}
          <button type="button" className="crail-manage" onClick={openConnectors}>
            Connect…
          </button>
        </p>
      )}
    </div>
  );
}
