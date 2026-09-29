import { randomUUID } from 'node:crypto';
import type { McpCheck, McpScope, McpTransport } from '@spark-outpost/contracts';
import { mcpFingerprint, type McpServerConfig } from '../agent-config/mcp-json.ts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';

export interface StoredUserConfig {
  command: string | null;
  args: string[];
  url: string | null;
  envNames: string[];
  headerNames: string[];
  secretNames: string[];
}

export interface UserMcpRow {
  id: string;
  source: string;
  name: string;
  transport: McpTransport;
  config: StoredUserConfig;
  fingerprint: string;
  check: McpCheck | null;
}

export interface EnablementRow {
  serverId: string;
  scope: McpScope;
  scopeKey: string;
  enabled: boolean;
  fingerprint: string;
}

export const GLOBAL_KEY = 'global';

interface ServerDbRow {
  id: string;
  source: string;
  name: string;
  transport: McpTransport;
  config: Partial<StoredUserConfig>;
  fingerprint: string;
  last_check: McpCheck | null;
}

function toRow(row: ServerDbRow): UserMcpRow {
  return {
    id: row.id,
    source: row.source,
    name: row.name,
    transport: row.transport,
    fingerprint: row.fingerprint,
    check: row.last_check,
    config: {
      command: row.config.command ?? null,
      args: row.config.args ?? [],
      url: row.config.url ?? null,
      envNames: row.config.envNames ?? [],
      headerNames: row.config.headerNames ?? [],
      secretNames: row.config.secretNames ?? [],
    },
  };
}

export function userFingerprint(server: Omit<McpServerConfig, 'fingerprint'>): string {
  const blank = (map: Record<string, string>) =>
    Object.fromEntries(Object.keys(map).map((key) => [key, '']));
  return mcpFingerprint({ ...server, env: blank(server.env), headers: blank(server.headers) });
}

export function storedUserConfig(
  server: Omit<McpServerConfig, 'fingerprint'>,
  secretNames: string[],
): StoredUserConfig {
  return {
    command: server.command,
    args: server.args,
    url: server.url,
    envNames: Object.keys(server.env).sort(),
    headerNames: Object.keys(server.headers).sort(),
    secretNames,
  };
}

const SERVER_COLUMNS = 'id, source, name, transport, config, fingerprint, last_check';

export async function listUserMcp(db: Queryable, workspaceId: string): Promise<UserMcpRow[]> {
  const { rows } = await db.query<ServerDbRow>(
    `SELECT ${SERVER_COLUMNS} FROM mcp_servers
      WHERE workspace_id = $1 AND source <> 'project' ORDER BY lower(name), source`,
    [workspaceId],
  );
  return rows.map(toRow);
}

export async function getUserMcp(
  db: Queryable,
  workspaceId: string,
  id: string,
): Promise<UserMcpRow | null> {
  const { rows } = await db.query<ServerDbRow>(
    `SELECT ${SERVER_COLUMNS} FROM mcp_servers
      WHERE workspace_id = $1 AND id = $2 AND source <> 'project'`,
    [workspaceId, id],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

export async function enablementsFor(
  db: Queryable,
  serverIds: readonly string[],
): Promise<EnablementRow[]> {
  const { rows } = await db.query<{
    server_id: string;
    scope: McpScope;
    scope_key: string;
    enabled: boolean;
    fingerprint: string;
  }>(
    `SELECT server_id, scope, scope_key, enabled, fingerprint FROM mcp_server_enablements
      WHERE server_id = ANY($1::uuid[])`,
    [serverIds],
  );
  return rows.map((row) => ({
    serverId: row.server_id,
    scope: row.scope,
    scopeKey: row.scope_key,
    enabled: row.enabled,
    fingerprint: row.fingerprint,
  }));
}

export interface SaveUserServer {
  source: string;
  name: string;
  transport: McpTransport;
  config: StoredUserConfig;
  fingerprint: string;
}

export async function upsertUserMcp(
  db: Queryable,
  workspaceId: string,
  server: SaveUserServer,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO mcp_servers (id, workspace_id, source, name, transport, config, fingerprint)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (workspace_id, source, name) WHERE source <> 'project' DO UPDATE SET
       transport = EXCLUDED.transport, config = EXCLUDED.config,
       fingerprint = EXCLUDED.fingerprint, updated_at = now()
     RETURNING id`,
    [
      randomUUID(),
      workspaceId,
      server.source,
      server.name,
      server.transport,
      server.config,
      server.fingerprint,
    ],
  );
  return rows[0]!.id;
}

export async function updateUserMcp(
  db: Queryable,
  id: string,
  server: Omit<SaveUserServer, 'source'>,
): Promise<void> {
  await db.query(
    `UPDATE mcp_servers SET name = $2, transport = $3, config = $4, fingerprint = $5,
            updated_at = now()
      WHERE id = $1`,
    [id, server.name, server.transport, server.config, server.fingerprint],
  );
}

export async function recordCheck(db: Queryable, id: string, check: McpCheck): Promise<void> {
  await db.query('UPDATE mcp_servers SET last_check = $2 WHERE id = $1', [id, check]);
}

export async function deleteUserMcp(db: Queryable, workspaceId: string, id: string) {
  await db.query(
    `DELETE FROM mcp_servers WHERE workspace_id = $1 AND id = $2 AND source <> 'project'`,
    [workspaceId, id],
  );
}

export interface EnablementChange {
  scope: McpScope;
  scopeKey: string;
  enabled: boolean | null;
}

export async function setUserEnablement(
  db: Db,
  workspaceId: string,
  server: UserMcpRow,
  change: EnablementChange,
): Promise<void> {
  await withTransaction(db, async (client) => {
    if (change.enabled === null) {
      await client.query(
        `DELETE FROM mcp_server_enablements
          WHERE server_id = $1 AND scope = $2 AND scope_key = $3`,
        [server.id, change.scope, change.scopeKey],
      );
    } else {
      await client.query(
        `INSERT INTO mcp_server_enablements (server_id, scope, scope_key, enabled, fingerprint)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (server_id, scope, scope_key) DO UPDATE SET
           enabled = EXCLUDED.enabled, fingerprint = EXCLUDED.fingerprint, updated_at = now()`,
        [server.id, change.scope, change.scopeKey, change.enabled, server.fingerprint],
      );
    }
    await client.query(
      `INSERT INTO agent_config_audit (id, workspace_id, project_id, subject, target, enabled, detail)
       VALUES ($1, $2, $3, 'mcp', $4, $5, $6)`,
      [
        randomUUID(),
        workspaceId,
        change.scope === 'project' ? change.scopeKey : null,
        server.name,
        change.enabled === true,
        {
          scope: change.scope,
          scopeKey: change.scopeKey,
          cleared: change.enabled === null,
          source: server.source,
          transport: server.transport,
          fingerprint: server.fingerprint,
          command: server.config.command,
          args: server.config.args,
          url: server.config.url,
          envNames: server.config.envNames,
          headerNames: server.config.headerNames,
        },
      ],
    );
  });
}

export async function conversationWorkspace(
  db: Queryable,
  conversationId: string,
): Promise<string | null> {
  const { rows } = await db.query<{ workspace_id: string }>(
    'SELECT workspace_id FROM conversations WHERE id = $1',
    [conversationId],
  );
  return rows[0]?.workspace_id ?? null;
}
