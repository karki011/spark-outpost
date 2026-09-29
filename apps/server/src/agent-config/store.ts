import { randomUUID } from 'node:crypto';
import type { AgentConfigSwitch } from '@spark-outpost/contracts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';
import { storedMcpConfig, type McpServerConfig } from './mcp-json.ts';

export interface AgentSettingsRow {
  instructions: boolean;
  skills: boolean;
  commands: boolean;
  subagents: boolean;
  hooksFingerprint: string | null;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettingsRow = {
  instructions: true,
  skills: true,
  commands: true,
  subagents: true,
  hooksFingerprint: null,
};

export interface AgentSettingsChange {
  switches: Partial<Record<AgentConfigSwitch, boolean>>;
  hooks?: { enabled: boolean; fingerprint: string | null; commands: string[] };
}

interface SettingsDbRow {
  project_id: string;
  instructions: boolean;
  skills: boolean;
  commands: boolean;
  subagents: boolean;
  hooks_fingerprint: string | null;
}

function toSettings(row: SettingsDbRow | undefined): AgentSettingsRow {
  if (!row) return { ...DEFAULT_AGENT_SETTINGS };
  return {
    instructions: row.instructions,
    skills: row.skills,
    commands: row.commands,
    subagents: row.subagents,
    hooksFingerprint: row.hooks_fingerprint,
  };
}

export async function agentSettingsFor(
  db: Queryable,
  projectIds: readonly string[],
): Promise<Map<string, AgentSettingsRow>> {
  const { rows } = await db.query<SettingsDbRow>(
    'SELECT * FROM project_agent_settings WHERE project_id = ANY($1::uuid[])',
    [projectIds],
  );
  const byProject = new Map(rows.map((row) => [row.project_id, row]));
  return new Map(projectIds.map((id) => [id, toSettings(byProject.get(id))]));
}

export async function audit(
  db: Queryable,
  workspaceId: string,
  projectId: string | null,
  subject: string,
  enabled: boolean,
  target: string | null = null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    `INSERT INTO agent_config_audit (id, workspace_id, project_id, subject, target, enabled, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), workspaceId, projectId, subject, target, enabled, detail],
  );
}

export async function updateAgentSettings(
  db: Db,
  workspaceId: string,
  projectId: string,
  change: AgentSettingsChange,
): Promise<AgentSettingsRow> {
  return withTransaction(db, async (client) => {
    const current = (await agentSettingsFor(client, [projectId])).get(projectId)!;
    const next: AgentSettingsRow = { ...current, ...change.switches };
    if (change.hooks)
      next.hooksFingerprint = change.hooks.enabled ? change.hooks.fingerprint : null;
    await client.query(
      `INSERT INTO project_agent_settings
         (project_id, instructions, skills, commands, subagents, hooks_fingerprint, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (project_id) DO UPDATE SET
         instructions = EXCLUDED.instructions, skills = EXCLUDED.skills,
         commands = EXCLUDED.commands, subagents = EXCLUDED.subagents,
         hooks_fingerprint = EXCLUDED.hooks_fingerprint, updated_at = now()`,
      [
        projectId,
        next.instructions,
        next.skills,
        next.commands,
        next.subagents,
        next.hooksFingerprint,
      ],
    );
    for (const [subject, enabled] of Object.entries(change.switches)) {
      if (current[subject as AgentConfigSwitch] !== enabled) {
        await audit(client, workspaceId, projectId, subject, enabled);
      }
    }
    if (change.hooks && current.hooksFingerprint !== next.hooksFingerprint) {
      await audit(client, workspaceId, projectId, 'hooks', change.hooks.enabled, null, {
        fingerprint: change.hooks.fingerprint,
        commands: change.hooks.commands,
      });
    }
    return next;
  });
}

export async function setProjectMcpServer(
  db: Db,
  workspaceId: string,
  projectId: string,
  server: McpServerConfig,
  enabled: boolean,
): Promise<void> {
  await withTransaction(db, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO mcp_servers
         (id, workspace_id, source, project_id, name, transport, config, fingerprint)
       VALUES ($1, $2, 'project', $3, $4, $5, $6, $7)
       ON CONFLICT (project_id, name) WHERE source = 'project' DO UPDATE SET
         transport = EXCLUDED.transport, config = EXCLUDED.config,
         fingerprint = EXCLUDED.fingerprint, updated_at = now()
       RETURNING id`,
      [
        randomUUID(),
        workspaceId,
        projectId,
        server.name,
        server.transport,
        storedMcpConfig(server),
        server.fingerprint,
      ],
    );
    await client.query(
      `INSERT INTO mcp_server_enablements (server_id, scope, scope_key, enabled, fingerprint)
       VALUES ($1, 'project', $2, $3, $4)
       ON CONFLICT (server_id, scope, scope_key) DO UPDATE SET
         enabled = EXCLUDED.enabled, fingerprint = EXCLUDED.fingerprint, updated_at = now()`,
      [rows[0]!.id, projectId, enabled, server.fingerprint],
    );
    await audit(client, workspaceId, projectId, 'mcp', enabled, server.name, {
      fingerprint: server.fingerprint,
      transport: server.transport,
      ...storedMcpConfig(server),
    });
  });
}

export async function enabledProjectMcp(
  db: Queryable,
  projectIds: readonly string[],
): Promise<Map<string, Map<string, string>>> {
  const { rows } = await db.query<{ project_id: string; name: string; fingerprint: string }>(
    `SELECT s.project_id, s.name, e.fingerprint
       FROM mcp_servers s
       JOIN mcp_server_enablements e
         ON e.server_id = s.id AND e.scope = 'project' AND e.scope_key = s.project_id::text
      WHERE s.source = 'project' AND e.enabled AND s.project_id = ANY($1::uuid[])`,
    [projectIds],
  );
  const byProject = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const names = byProject.get(row.project_id) ?? new Map<string, string>();
    names.set(row.name, row.fingerprint);
    byProject.set(row.project_id, names);
  }
  return byProject;
}

export async function conversationProjectIds(
  db: Queryable,
  conversationId: string,
): Promise<string[]> {
  const { rows } = await db.query<{ project_id: string }>(
    `SELECT project_id FROM conversation_projects
      WHERE conversation_id = $1 ORDER BY position, created_at`,
    [conversationId],
  );
  return rows.map((row) => row.project_id);
}
