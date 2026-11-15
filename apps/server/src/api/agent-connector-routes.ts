import { Router } from 'express';
import type { AgentConnectorsResponse } from '@spark-outpost/contracts';
import { productLive } from '../atlassian/session.ts';
import { connectorSummary } from '../agent-connectors/summary.ts';
import { googleAccounts } from '../calendar/google/store.ts';
import { calendarConnection } from '../calendar/store.ts';
import { getTicketConnection } from '../persistence/ticket-connections.ts';
import { getSlackConnection } from '../persistence/slack.ts';
import { openSlack, type SlackDeps } from '../slack/connection.ts';
import type { SlackSignInConfig } from '../slack/sign-in-config.ts';
import { gitHubReachability } from '../ship/github/access.ts';
import { connectedSources, savedSecret, type TicketDeps } from '../tickets/connections.ts';
import type { TicketSourceId } from '@spark-outpost/contracts';
import { gitHubDepsOf, type GitHubRouteDeps } from './ship-routes.ts';

export interface AgentConnectorRouteDeps extends GitHubRouteDeps {
  linearApiUrl?: string | undefined;
  slackApiUrl?: string | undefined;
  slackSignIn?: SlackSignInConfig | null | undefined;
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
  const slackDeps: SlackDeps = {
    db,
    workspaceId,
    secrets: routeDeps.secrets,
    fetch: routeDeps.endpoints.fetch,
    slackApiUrl: routeDeps.slackApiUrl,
    signIn: routeDeps.slackSignIn,
  };
  const saved = async (source: TicketSourceId) =>
    (await getTicketConnection(db, workspaceId, source)) !== null &&
    (await savedSecret(tickets, source)) !== null;
  const router = Router();
  router.get('/agent-connectors', async (_req, res) => {
    const [github, atlassian, jira, confluence, serviceNow, sources, slackRow, slack] =
      await Promise.all([
        gitHubReachability(gitHubDepsOf(routeDeps)),
        saved('jira'),
        productLive(tickets, 'jira'),
        productLive(tickets, 'confluence'),
        saved('servicenow'),
        connectedSources(tickets),
        getSlackConnection(db, workspaceId),
        openSlack(slackDeps).catch(() => null),
      ]);
    const [calendar, google] = await Promise.all([
      calendarConnection(db, workspaceId),
      googleAccounts(db, workspaceId),
    ]);
    const source = (id: string) => sources.some((open) => open.connection.source === id);
    const response: AgentConnectorsResponse = {
      connectors: connectorSummary({
        github: github.saved || github.ghLogin !== null,
        atlassianConnected: atlassian,
        jira,
        confluence,
        linear: source('linear'),
        servicenowConnected: serviceNow,
        servicenow: source('servicenow'),
        slackConnected: slackRow !== null,
        slack: slack !== null,
        calendarConnected: calendar.connected || google.some((account) => !account.needsSignIn),
        calendarAgentsRead: calendar.settings.agentsRead,
      }),
    };
    res.json(response);
  });
  return router;
}
