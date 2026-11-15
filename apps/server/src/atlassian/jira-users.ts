import { z } from 'zod';
import { TicketApiError } from '../tickets/source.ts';
import type { AtlassianClient } from './access.ts';

const userSchema = z.object({
  accountId: z.string(),
  displayName: z.string().optional(),
  active: z.boolean().optional(),
  accountType: z.string().optional(),
});
const usersSchema = z.array(userSchema);

export interface JiraUser {
  accountId: string;
  name: string;
  active: boolean;
}

const ACCOUNT_ID = /^(\d+:)?[0-9a-f-]{20,}$/i;

const userOf = (user: z.infer<typeof userSchema>): JiraUser => ({
  accountId: user.accountId,
  name: user.displayName ?? user.accountId,
  active: user.active ?? true,
});

export async function searchUsers(
  client: AtlassianClient,
  query: string,
  issueKey: string | null,
  limit = 20,
): Promise<JiraUser[]> {
  const q = encodeURIComponent(query);
  const path = issueKey
    ? `/rest/api/3/user/assignable/search?issueKey=${encodeURIComponent(issueKey)}&query=${q}&maxResults=${limit}`
    : `/rest/api/3/user/search?query=${q}&maxResults=${limit}`;
  const found = await client.call(usersSchema, { method: 'GET', path }, 'looking up people');
  return found.filter((user) => user.accountType !== 'app').map(userOf);
}

async function userById(client: AtlassianClient, accountId: string): Promise<JiraUser> {
  const user = await client.call(
    userSchema,
    { method: 'GET', path: `/rest/api/3/user?accountId=${encodeURIComponent(accountId)}` },
    `looking up the account ${accountId}`,
  );
  return userOf(user);
}

export interface UserContext {
  me: string | null;
  issueKey: string | null;
}

export async function resolveUser(
  client: AtlassianClient,
  wanted: string,
  context: UserContext,
): Promise<JiraUser | null> {
  const trimmed = wanted.trim();
  if (/^(none|nobody|unassigned)$/i.test(trimmed)) return null;
  if (/^me$/i.test(trimmed)) {
    if (!context.me) throw new TicketApiError(400, "Spark doesn't know your Jira account yet.");
    return userById(client, context.me);
  }
  if (ACCOUNT_ID.test(trimmed)) return userById(client, trimmed);
  const found = await searchUsers(client, trimmed, context.issueKey);
  const exact = found.filter((user) => user.name.toLowerCase() === trimmed.toLowerCase());
  const pick = exact.length === 1 ? exact : found;
  if (pick.length === 1) return pick[0]!;
  const names = found
    .slice(0, 8)
    .map((user) => `${user.name} (${user.accountId})`)
    .join(', ');
  throw new TicketApiError(
    400,
    found.length === 0
      ? `No Jira user matches "${trimmed}". Nothing was changed.`
      : `"${trimmed}" matches several people: ${names}. Nothing was changed; pass an accountId.`,
  );
}
