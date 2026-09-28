import type { RepoAgentConfig } from '@spark-outpost/contracts';
import type { RepoScan } from './discovery.ts';
import type { AgentSettingsRow } from './store.ts';

export function hooksApproved(settings: AgentSettingsRow, scan: RepoScan): boolean {
  return settings.hooksFingerprint !== null && settings.hooksFingerprint === scan.hooksFingerprint;
}

export function agentConfigView(
  project: { id: string; rootPath: string },
  scan: RepoScan,
  settings: AgentSettingsRow,
  enabledMcp: ReadonlyMap<string, string>,
): RepoAgentConfig {
  const approved = hooksApproved(settings, scan);
  return {
    projectId: project.id,
    rootPath: project.rootPath,
    settings: {
      instructions: settings.instructions,
      skills: settings.skills,
      commands: settings.commands,
      subagents: settings.subagents,
      hooks: approved,
      hooksChanged: settings.hooksFingerprint !== null && !approved,
    },
    instructions: scan.instructions,
    skills: scan.skills,
    commands: scan.commands,
    subagents: scan.subagents,
    hooks: scan.hooks,
    hooksFingerprint: scan.hooksFingerprint,
    mcpServers: scan.mcpServers.map((server) => {
      const approvedFingerprint = enabledMcp.get(server.name);
      return {
        name: server.name,
        transport: server.transport,
        command: server.command,
        args: server.args,
        url: server.url,
        envNames: Object.keys(server.env).sort(),
        headerNames: Object.keys(server.headers).sort(),
        fingerprint: server.fingerprint,
        enabled: approvedFingerprint === server.fingerprint,
        changed: approvedFingerprint !== undefined && approvedFingerprint !== server.fingerprint,
      };
    }),
    ignored: scan.ignored,
    warnings: scan.warnings,
  };
}
