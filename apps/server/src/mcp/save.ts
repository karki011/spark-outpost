import type { SaveUserMcpRequest } from '@spark-outpost/contracts';
import { BadRequestError } from '../api/validation.ts';
import type { Db, Queryable } from '../persistence/db.ts';
import type { SecretStore } from '../setup/secrets.ts';
import {
  deleteMcpSecrets,
  readMcpSecrets,
  secretNames,
  writeMcpSecrets,
  type McpSecretValues,
} from './secrets.ts';
import {
  storedUserConfig,
  updateUserMcp,
  upsertUserMcp,
  userFingerprint,
  deleteUserMcp,
  type UserMcpRow,
} from './store.ts';

export interface SaveDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
}

function nextSecrets(body: SaveUserMcpRequest, current: McpSecretValues): McpSecretValues {
  const merge = (given: Record<string, string>, stored: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(given).flatMap(([name, value]) => {
        const kept = value === '' ? stored[name] : value;
        return kept === undefined ? [] : [[name, kept]];
      }),
    );
  return { env: merge(body.env, current.env), headers: merge(body.headers, current.headers) };
}

async function nameTaken(db: Queryable, workspaceId: string, name: string, id: string | null) {
  const { rowCount } = await db.query(
    `SELECT 1 FROM mcp_servers
      WHERE workspace_id = $1 AND source = 'user' AND name = $2 AND id IS DISTINCT FROM $3`,
    [workspaceId, name, id],
  );
  return (rowCount ?? 0) > 0;
}

export async function saveManualServer(
  { db, workspaceId, secrets }: SaveDeps,
  existing: UserMcpRow | null,
  body: SaveUserMcpRequest,
): Promise<string> {
  if (await nameTaken(db, workspaceId, body.name, existing?.id ?? null)) {
    throw new BadRequestError(`You already have an MCP server named ${body.name}.`);
  }
  const stdio = body.transport === 'stdio';
  const server = {
    name: body.name,
    transport: body.transport,
    command: stdio ? body.command : null,
    args: stdio ? body.args : [],
    url: stdio ? null : body.url,
    env: stdio ? body.env : {},
    headers: stdio ? {} : body.headers,
  };
  const current = existing ? await readMcpSecrets(secrets, existing.id) : { env: {}, headers: {} };
  const values = nextSecrets({ ...body, env: server.env, headers: server.headers }, current);
  const saved = {
    name: server.name,
    transport: server.transport,
    config: storedUserConfig(server, secretNames(values)),
    fingerprint: userFingerprint(server),
  };
  if (existing) {
    await updateUserMcp(db, existing.id, saved);
    await writeMcpSecrets(secrets, existing.id, values);
    return existing.id;
  }
  const id = await upsertUserMcp(db, workspaceId, { ...saved, source: 'user' });
  try {
    await writeMcpSecrets(secrets, id, values);
  } catch (error) {
    await deleteUserMcp(db, workspaceId, id);
    await deleteMcpSecrets(secrets, id);
    throw error;
  }
  return id;
}
