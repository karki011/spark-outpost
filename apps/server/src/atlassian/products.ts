import { z } from 'zod';
import type { AtlassianProducts, AtlassianReach } from '@spark-outpost/contracts';
import type { AtlassianProductRow, StoredReach } from '../persistence/ticket-connections.ts';
import { isOk, type JsonAnswer } from '../tickets/http.ts';
import { TicketApiError } from '../tickets/source.ts';
import { atlassianClient, type AtlassianAccess } from './access.ts';

const PROBE_TIMEOUT_MS = 8_000;

const jiraMeSchema = z.object({
  accountId: z.string(),
  displayName: z.string(),
  emailAddress: z.string().nullable().optional(),
});

const confluenceMeSchema = z.object({
  accountId: z.string(),
  displayName: z.string().optional(),
  publicName: z.string().optional(),
  email: z.string().nullable().optional(),
});

export interface ProductProbe {
  jira: StoredReach;
  confluence: StoredReach;
  account: { id: string; name: string } | null;
  rejected: boolean;
  firstFailure: JsonAnswer | null;
}

const DENIED_STATUSES = new Set([401, 403, 404]);

function reachOf(answer: JsonAnswer | null): StoredReach {
  if (!answer) return null;
  if (isOk(answer)) return 'reachable';
  return DENIED_STATUSES.has(answer.status) ? 'denied' : null;
}

async function quietly(work: Promise<JsonAnswer>): Promise<JsonAnswer | null> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof TicketApiError) return null;
    throw error;
  }
}

export async function probeConfluence(
  access: AtlassianAccess,
  fetchImpl: typeof fetch,
): Promise<StoredReach> {
  const confluence = atlassianClient(access, fetchImpl, { name: 'Confluence', thing: 'page' });
  const answer = await quietly(
    confluence.raw({
      method: 'GET',
      path: '/wiki/api/v2/spaces?limit=1',
      timeoutMs: PROBE_TIMEOUT_MS,
    }),
  );
  return reachOf(answer);
}

async function confluenceAccount(access: AtlassianAccess, fetchImpl: typeof fetch) {
  const confluence = atlassianClient(access, fetchImpl, { name: 'Confluence', thing: 'page' });
  const me = await confluence
    .call(
      confluenceMeSchema,
      { method: 'GET', path: '/wiki/rest/api/user/current', timeoutMs: PROBE_TIMEOUT_MS },
      'checking who you are',
    )
    .catch(() => null);
  if (!me) return null;
  return { id: me.accountId, name: me.email ?? me.displayName ?? me.publicName ?? access.email };
}

export async function probeProducts(
  access: AtlassianAccess,
  fetchImpl: typeof fetch,
): Promise<ProductProbe> {
  const jira = atlassianClient(access, fetchImpl, { name: 'Jira', thing: 'ticket' });
  const [jiraAnswer, confluence] = await Promise.all([
    quietly(jira.raw({ method: 'GET', path: '/rest/api/3/myself', timeoutMs: PROBE_TIMEOUT_MS })),
    probeConfluence(access, fetchImpl),
  ]);
  const jiraReach = reachOf(jiraAnswer);
  const me = jiraReach === 'reachable' ? jiraMeSchema.safeParse(jiraAnswer?.data) : null;
  let account = me?.success
    ? { id: me.data.accountId, name: me.data.emailAddress ?? me.data.displayName }
    : null;
  if (!account && confluence === 'reachable') account = await confluenceAccount(access, fetchImpl);
  return {
    jira: me && !me.success ? null : jiraReach,
    confluence,
    account,
    rejected: jiraAnswer?.status === 401 && confluence !== 'reachable',
    firstFailure: jiraAnswer && !isOk(jiraAnswer) ? jiraAnswer : null,
  };
}

const reachView = (reach: StoredReach): AtlassianReach => reach ?? 'unchecked';

export function productsView(row: AtlassianProductRow): AtlassianProducts {
  return {
    jira: { reach: reachView(row.jiraReach), on: row.jiraOn },
    confluence: { reach: reachView(row.confluenceReach), on: row.confluenceOn },
  };
}

export function productsOnConnect(probe: ProductProbe): AtlassianProductRow {
  return {
    jiraOn: probe.jira === 'reachable',
    jiraReach: probe.jira,
    confluenceOn: probe.confluence === 'reachable',
    confluenceReach: probe.confluence,
  };
}
