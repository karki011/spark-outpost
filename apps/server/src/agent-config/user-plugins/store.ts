import { withTransaction, type Db, type Queryable } from '../../persistence/db.ts';
import { audit } from '../store.ts';
import type { ScannedPlugin } from './scan.ts';

export interface PluginChoice {
  enabled: boolean;
  fingerprint: string | null;
}

export async function pluginChoices(
  db: Queryable,
  workspaceId: string,
): Promise<Map<string, PluginChoice>> {
  const { rows } = await db.query<{
    plugin_key: string;
    enabled: boolean;
    fingerprint: string | null;
  }>('SELECT plugin_key, enabled, fingerprint FROM user_plugin_trust WHERE workspace_id = $1', [
    workspaceId,
  ]);
  return new Map(
    rows.map((row) => [row.plugin_key, { enabled: row.enabled, fingerprint: row.fingerprint }]),
  );
}

function snapshotOf(plugin: ScannedPlugin) {
  return {
    version: plugin.installed.version,
    skills: plugin.parsed.skills,
    commands: plugin.parsed.commands,
    agents: plugin.parsed.agents,
    hooks: plugin.parsed.hooks.map((hook) => `${hook.event}: ${hook.command}`),
    mcpServers: plugin.parsed.mcpServers.map((server) => ({
      name: server.name,
      fingerprint: server.fingerprint,
    })),
    status: plugin.status,
    findings: plugin.findings.map(
      (finding) => `${finding.severity} ${finding.rule} ${finding.file}`,
    ),
  };
}

export interface PluginChooser {
  chat: string;
  agent: string;
}

interface ChoiceWrite {
  enabled: boolean;
  confirmFindings: boolean;
  by?: PluginChooser;
}

export async function setPluginChoice(
  db: Db,
  workspaceId: string,
  plugin: ScannedPlugin,
  { enabled, confirmFindings, by }: ChoiceWrite,
): Promise<void> {
  const fingerprint = enabled ? plugin.fingerprint : null;
  const snapshot = snapshotOf(plugin);
  await withTransaction(db, async (client) => {
    await client.query(
      `INSERT INTO user_plugin_trust (workspace_id, plugin_key, enabled, fingerprint, snapshot, decided_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (workspace_id, plugin_key) DO UPDATE SET
         enabled = EXCLUDED.enabled, fingerprint = EXCLUDED.fingerprint,
         snapshot = EXCLUDED.snapshot, decided_at = now()`,
      [
        workspaceId,
        plugin.installed.key,
        enabled,
        fingerprint,
        JSON.stringify(enabled ? snapshot : {}),
      ],
    );
    await audit(client, workspaceId, null, 'user-plugin', enabled, plugin.installed.key, {
      fingerprint: plugin.fingerprint,
      ...(by ? { askedBy: by.agent, chat: by.chat } : {}),
      ...(enabled ? { confirmedFindings: confirmFindings, ...snapshot } : {}),
    });
  });
}
