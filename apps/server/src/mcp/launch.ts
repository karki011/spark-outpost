import type { McpServerConfig } from '../agent-config/mcp-json.ts';
import type { Queryable } from '../persistence/db.ts';
import type { SecretStore } from '../setup/secrets.ts';
import { effectiveFor } from './effective.ts';
import { keepNames, readMcpSecrets } from './secrets.ts';
import { conversationWorkspace, enablementsFor, listUserMcp, type UserMcpRow } from './store.ts';

export interface UserMcpLaunch {
  id: string;
  name: string;
  transport: McpServerConfig['transport'];
  command: string | null;
  args: string[];
  url: string | null;
  envNames: string[];
  headerNames: string[];
  fingerprint: string;
}

export function launchOf(server: UserMcpRow): UserMcpLaunch {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.config.command,
    args: server.config.args,
    url: server.config.url,
    envNames: server.config.envNames,
    headerNames: server.config.headerNames,
    fingerprint: server.fingerprint,
  };
}

export async function loadUserMcp(
  db: Queryable,
  conversationId: string,
  projectIds: readonly string[],
): Promise<UserMcpLaunch[]> {
  const workspaceId = await conversationWorkspace(db, conversationId);
  if (!workspaceId) return [];
  const servers = await listUserMcp(db, workspaceId);
  if (servers.length === 0) return [];
  const rows = await enablementsFor(
    db,
    servers.map((server) => server.id),
  );
  return servers
    .filter((server) => effectiveFor(server, rows, conversationId, projectIds).enabled)
    .map(launchOf);
}

export async function resolveUserServer(
  server: UserMcpLaunch,
  secrets: Pick<SecretStore, 'get'> | undefined,
): Promise<McpServerConfig> {
  const values = keepNames(
    await readMcpSecrets(secrets, server.id),
    server.envNames,
    server.headerNames,
  );
  return {
    name: server.name,
    transport: server.transport,
    command: server.command,
    args: server.args,
    url: server.url,
    env: values.env,
    headers: values.headers,
    fingerprint: server.fingerprint,
  };
}

export function resolveUserMcp(
  servers: readonly UserMcpLaunch[],
  secrets: Pick<SecretStore, 'get'> | undefined,
): Promise<McpServerConfig[]> {
  return Promise.all(servers.map((server) => resolveUserServer(server, secrets)));
}
