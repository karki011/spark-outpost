import type { IgnoredSetting, RepoAgentConfig } from '@spark-outpost/contracts';
import { classifyAllowRule } from './allow-rules.ts';
import type { RepoScan } from './discovery.ts';
import { isRedirectCommand, isRedirectEnv, shownValue } from './redirects.ts';
import type { AgentSettingsRow } from './store.ts';
import { folderTrust, type TrustRow } from './trust.ts';

export function hooksApproved(settings: AgentSettingsRow, scan: RepoScan): boolean {
  return settings.hooksFingerprint !== null && settings.hooksFingerprint === scan.hooksFingerprint;
}

function stillIgnored(group: IgnoredSetting): IgnoredSetting[] {
  if (group.kind === 'allow') return [];
  const items = group.items.filter((item) => {
    if (group.kind === 'env') return !isRedirectEnv(item);
    if (group.kind === 'command') return !isRedirectCommand(item.split(':')[0] ?? '');
    return true;
  });
  return items.length > 0 ? [{ ...group, items }] : [];
}

export function agentConfigView(
  project: { id: string; rootPath: string },
  scan: RepoScan,
  settings: AgentSettingsRow,
  enabledMcp: ReadonlyMap<string, string>,
  trustRow: TrustRow | null = null,
): RepoAgentConfig {
  const trust = folderTrust(scan, trustRow);
  const trusted = trust.state === 'trusted';
  const approved = hooksApproved(settings, scan);
  return {
    projectId: project.id,
    rootPath: project.rootPath,
    settings: {
      instructions: settings.instructions,
      skills: settings.skills,
      commands: settings.commands,
      subagents: settings.subagents,
      hooks: trusted ? scan.hooks.length > 0 : approved,
      hooksChanged: !trusted && settings.hooksFingerprint !== null && !approved,
    },
    instructions: scan.instructions,
    skills: scan.skills,
    commands: scan.commands,
    subagents: scan.subagents,
    hooks: scan.hooks,
    hooksFingerprint: scan.hooksFingerprint,
    mcpServers: scan.mcpServers.map((server) => {
      const approvedFingerprint = enabledMcp.get(server.name);
      const reviewed = approvedFingerprint === server.fingerprint;
      return {
        name: server.name,
        transport: server.transport,
        command: server.command,
        args: server.args,
        url: server.url,
        envNames: Object.keys(server.env).sort(),
        headerNames: Object.keys(server.headers).sort(),
        fingerprint: server.fingerprint,
        enabled: trusted || reviewed,
        changed: !trusted && approvedFingerprint !== undefined && !reviewed,
      };
    }),
    allowRules: scan.allowRules.map((entry) => {
      const verdict = classifyAllowRule(entry.rule);
      return {
        rule: entry.rule,
        source: entry.source,
        applied: trusted && verdict.applied,
        reason: verdict.reason,
      };
    }),
    redirects: scan.redirects.map((setting) => ({
      kind: setting.kind,
      name: setting.name,
      value: shownValue(setting),
      source: setting.source,
    })),
    trust,
    ignored: scan.ignored.flatMap(stillIgnored),
    warnings: scan.warnings,
  };
}
