import type { IgnoredSetting, RepoAgentConfig, TrustChange } from '@spark-outpost/contracts';
import { countLabel } from '../../ui/count-label.ts';

type TrustPrompt = 'ask' | 'changed' | null;

export function trustPrompt(config: RepoAgentConfig): TrustPrompt {
  const { trust } = config;
  if (!trust.needed) return null;
  if (trust.state === 'changed') return 'changed';
  return trust.state === 'unset' ? 'ask' : null;
}

export function executableSummary(config: RepoAgentConfig): string {
  const parts = [
    config.hooks.length > 0 ? countLabel(config.hooks.length, 'hook') : null,
    config.allowRules.length > 0 ? countLabel(config.allowRules.length, 'allow rule') : null,
    config.mcpServers.length > 0 ? countLabel(config.mcpServers.length, 'MCP server') : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(', ') : 'Key or proxy settings only';
}

export const CHANGE_LABELS: Record<TrustChange['change'], string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
};

export const CHANGE_KINDS: Record<TrustChange['kind'], string> = {
  hook: 'hook',
  allow: 'allow rule',
  mcp: 'MCP server',
};

export function needsAttention(config: RepoAgentConfig): boolean {
  if (trustPrompt(config) !== null) return true;
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

export function onOff(on: boolean): string {
  return on ? 'On' : 'Off';
}
