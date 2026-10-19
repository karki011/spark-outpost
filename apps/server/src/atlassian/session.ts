import {
  getTicketConnection,
  type TicketConnectionRow,
} from '../persistence/ticket-connections.ts';
import {
  atlassianAccessOf,
  confluenceLive,
  jiraLive,
  savedSecret,
  type TicketDeps,
} from '../tickets/connections.ts';
import { TicketNotConnectedError } from '../tickets/source.ts';
import { confluenceClient, type ConfluenceClient } from './confluence.ts';
import { jiraEdits, type JiraEdits } from './jira-edits.ts';

export type AtlassianProduct = 'jira' | 'confluence';

export interface AtlassianSession {
  connection: TicketConnectionRow;
  siteUrl: string;
  accountId: string | null;
  jira: JiraEdits;
  confluence: ConfluenceClient;
}

const OFF: Record<AtlassianProduct, string> = {
  jira: "Jira isn't on. Connect Atlassian in Settings → Connectors and turn on Jira.",
  confluence:
    "Confluence isn't on. Connect Atlassian in Settings → Connectors and turn on Confluence.",
};

export async function productLive(deps: TicketDeps, product: AtlassianProduct): Promise<boolean> {
  const connection = await getTicketConnection(deps.db, deps.workspaceId, 'jira');
  if (!connection) return false;
  const live = product === 'jira' ? jiraLive(connection) : confluenceLive(connection);
  return live && (await savedSecret(deps, 'jira')) !== null;
}

export async function openAtlassian(
  deps: TicketDeps,
  product: AtlassianProduct,
): Promise<AtlassianSession> {
  const connection = await getTicketConnection(deps.db, deps.workspaceId, 'jira');
  const secret = connection ? await savedSecret(deps, 'jira') : null;
  const live =
    connection && (product === 'jira' ? jiraLive(connection) : confluenceLive(connection));
  if (!connection || !secret || !live) throw new TicketNotConnectedError(OFF[product]);
  const access = atlassianAccessOf(connection, secret);
  return {
    connection,
    siteUrl: connection.apiUrl,
    accountId: connection.accountId,
    jira: jiraEdits(access, deps.fetch),
    confluence: confluenceClient(access, deps.fetch),
  };
}
