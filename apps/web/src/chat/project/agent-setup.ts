import type { IgnoredSetting, RepoAgentConfig } from '@spark-outpost/contracts';

export function needsAttention(config: RepoAgentConfig): boolean {
  const { settings } = config;
  const offWithContent =
    (!settings.instructions && config.instructions.length > 0) ||
    (!settings.skills && config.skills.length > 0) ||
    (!settings.commands && config.commands.length > 0) ||
    (!settings.subagents && config.subagents.length > 0) ||
    (!settings.hooks && config.hooks.length > 0) ||
    config.mcpServers.some((server) => !server.enabled);
  return offWithContent || settings.hooksChanged || config.warnings.length > 0;
}

export function followingLine(files: readonly string[]): string | null {
  return files.length > 0 ? `Following: ${files.join(', ')}` : null;
}

export const IGNORED_LABELS: Record<IgnoredSetting['kind'], string> = {
  allow: 'Permission allow rules',
  env: 'Environment variables',
  command: 'Commands in settings',
  setting: 'Other settings',
  codex: 'Codex project config',
};

export function ignoredCount(config: RepoAgentConfig): number {
  return config.ignored.reduce((total, group) => total + group.items.length, 0);
}
