import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { AgentConnector, AgentConnectorId } from '@spark-outpost/contracts';
import { agentConnectorsKey, fetchAgentConnectors } from '../../api/agent-connectors.ts';
import { requestSettings } from '../../settings/settings-request.ts';
import { QueryWait } from '../../ui/loading/QueryWait.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import { shipKeys } from '../../ship/ship-api.ts';
import { slackKeys } from '../../slack/slack-api.ts';
import { ToolsGroupFrame, ToolText } from './ToolsGroupFrame.tsx';

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
      <ToolText name={facts.name} note={note} status={!on} />
      {on ? (
        <span className="tools-state on">On</span>
      ) : (
        <button
          type="button"
          className="tools-link"
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

export function ConnectorTools() {
  useConnectorRefresh();
  const query = useQuery({ queryKey: agentConnectorsKey, queryFn: fetchAgentConnectors });
  const connectors = query.data?.connectors ?? [];
  const shown = connectors.filter((entry) => entry.state !== 'not_connected');
  const missing = connectors.filter((entry) => entry.state === 'not_connected');
  const on = shown.filter((entry) => entry.state === 'on').length;
  return (
    <ToolsGroupFrame
      groupKey="connectors"
      kind="connectors"
      title="Connectors"
      scope="every chat"
      summary={query.data ? `${on} on` : null}
    >
      <QueryWait query={query} what="connectors">
        <Skeleton label="Finding connectors" shape="list" rows={2} />
      </QueryWait>
      {shown.length > 0 && (
        <ul aria-label="Connectors">
          {shown.map((connector) => (
            <ConnectorRow key={connector.id} connector={connector} />
          ))}
        </ul>
      )}
      {missing.length > 0 && (
        <>
          <p className="tools-note">
            Not connected: {missing.map((entry) => CONNECTORS[entry.id].name).join(', ')}.
          </p>
          <button type="button" className="tools-link" onClick={openConnectors}>
            Connect…
          </button>
        </>
      )}
    </ToolsGroupFrame>
  );
}
