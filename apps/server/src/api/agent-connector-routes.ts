import { Router } from 'express';
import type { AgentConnectorsResponse } from '@spark-outpost/contracts';
import { productLive } from '../atlassian/session.ts';
import { connectorSummary } from '../agent-connectors/summary.ts';
import { googleAccounts } from '../calendar/google/store.ts';
import { calendarConnection } from '../calendar/store.ts';
import { getSlackConnection } from '../persistence/slack.ts';
import { gitHubReachability } from '../ship/github/access.ts';
import { connectedSources, type TicketDeps } from '../tickets/connections.ts';
import { gitHubDepsOf, type GitHubRouteDeps } from './ship-routes.ts';

export interface AgentConnectorRouteDeps extends GitHubRouteDeps {
  linearApiUrl?: string | undefined;
}

export function agentConnectorRoutes(routeDeps: AgentConnectorRouteDeps): Router {
  const { db, workspaceId } = routeDeps;
  const tickets: TicketDeps = {
    db,
    workspaceId,
    secrets: routeDeps.secrets,
    fetch: routeDeps.endpoints.fetch,
    linearApiUrl: routeDeps.linearApiUrl,
  };
  const router = Router();
  router.get('/agent-connectors', async (_req, res) => {
    const [github, jira, confluence, sources, slack, calendar, google] = await Promise.all([
      gitHubReachability(gitHubDepsOf(routeDeps)),
      productLive(tickets, 'jira'),
      productLive(tickets, 'confluence'),
      connectedSources(tickets),
      getSlackConnection(db, workspaceId),
      calendarConnection(db, workspaceId),
      googleAccounts(db, workspaceId),
    ]);
    const source = (id: string) => sources.some((open) => open.connection.source === id);
    const response: AgentConnectorsResponse = {
      connectors: connectorSummary({
        github: github.saved || github.ghLogin !== null,
        jira,
        confluence,
        linear: source('linear'),
        servicenow: source('servicenow'),
        slack: slack !== null,
        calendarConnected: calendar.connected || google.length > 0,
        calendarAgentsRead: calendar.settings.agentsRead,
      }),
    };
    res.json(response);
  });
  return router;
}
