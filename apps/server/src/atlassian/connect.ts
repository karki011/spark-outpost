import { ATLASSIAN_NAME, type TicketSourceId } from '@spark-outpost/contracts';
import {
  getTicketConnection,
  saveAtlassianProducts,
  type AtlassianProductRow,
  type StoredReach,
  type TicketConnectionRow,
} from '../persistence/ticket-connections.ts';
import { forgetDevelopment } from '../persistence/ticket-development.ts';
import type { TicketDeps } from '../tickets/connections.ts';
import { failure } from '../tickets/http.ts';
import {
  TicketApiError,
  TicketConflictError,
  TicketNotConnectedError,
  type TicketAccount,
} from '../tickets/source.ts';
import type { AtlassianAccess } from './access.ts';
import { probeProducts, productsOnConnect } from './products.ts';

type Product = 'jira' | 'confluence';

const NOT_REACHABLE: Record<Product, string> = {
  jira: "This token can't reach Jira on this site, so Jira stays off. Use a token that includes Jira and connect again.",
  confluence:
    "This token can't reach Confluence on this site, so Confluence stays off. Use a token that includes Confluence and connect again.",
};

export async function atlassianAccount(
  access: AtlassianAccess,
  fetchImpl: typeof fetch,
): Promise<{ who: TicketAccount; products: AtlassianProductRow }> {
  const probe = await probeProducts(access, fetchImpl);
  if (probe.account) return { who: probe.account, products: productsOnConnect(probe) };
  if (probe.rejected) {
    throw new TicketApiError(
      401,
      `${ATLASSIAN_NAME} rejected this token (401). Check that it's active and copied in full.`,
    );
  }
  if (probe.firstFailure) throw failure('Jira', 'checking who you are', probe.firstFailure);
  throw new TicketApiError(
    502,
    `Spark couldn't reach Jira or Confluence at ${access.siteUrl} with this token. Check the site address.`,
  );
}

const storedReach = (connection: TicketConnectionRow, product: Product): StoredReach =>
  product === 'jira' ? connection.jiraReach : connection.confluenceReach;

async function reachNow(
  deps: TicketDeps,
  connection: TicketConnectionRow,
  product: Product,
): Promise<StoredReach> {
  if (storedReach(connection, product) === 'reachable') return 'reachable';
  const secret = await deps.secrets.get('ticket:jira').catch(() => null);
  if (!secret) throw new TicketNotConnectedError(`${ATLASSIAN_NAME} isn't connected.`);
  const access = { siteUrl: connection.apiUrl, email: connection.email ?? '', apiToken: secret };
  const probe = await probeProducts(access, deps.fetch);
  const reach = probe[product];
  if (reach) {
    await saveAtlassianProducts(deps.db, deps.workspaceId, {
      [product === 'jira' ? 'jiraReach' : 'confluenceReach']: reach,
    });
  }
  return reach;
}

export async function switchProducts(
  deps: TicketDeps,
  source: TicketSourceId,
  wanted: { jiraOn?: boolean | undefined; confluenceOn?: boolean | undefined },
): Promise<void> {
  const connection =
    source === 'jira' ? await getTicketConnection(deps.db, deps.workspaceId, 'jira') : null;
  if (!connection) throw new TicketNotConnectedError(`${ATLASSIAN_NAME} isn't connected.`);
  for (const product of ['jira', 'confluence'] as const) {
    const on = product === 'jira' ? wanted.jiraOn : wanted.confluenceOn;
    if (on && (await reachNow(deps, connection, product)) !== 'reachable') {
      throw new TicketConflictError(NOT_REACHABLE[product]);
    }
  }
  await saveAtlassianProducts(deps.db, deps.workspaceId, wanted);
  if (wanted.jiraOn === false) await forgetDevelopment(deps.db, deps.workspaceId, 'jira');
}
