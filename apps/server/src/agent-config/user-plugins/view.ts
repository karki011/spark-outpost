import type { UserPlugin } from '@spark-outpost/contracts';
import { pluginCommandNames } from './parse.ts';
import type { ReviewedPlugin } from './review-result.ts';
import type { ScannedPlugin } from './scan.ts';
import { findingKey, type PluginChoice } from './store.ts';

function confirmed(plugin: ScannedPlugin, choice: PluginChoice | undefined): boolean {
  if (choice?.enabled !== true || choice.fingerprint !== plugin.fingerprint) return false;
  const seen = new Set(choice.confirmedFindings);
  return plugin.findings.every((finding) => seen.has(findingKey(finding)));
}

export function pluginLoads(plugin: ScannedPlugin, choice: PluginChoice | undefined): boolean {
  return confirmed(plugin, choice) && plugin.unloadableReason === null;
}

export function userPluginView(
  { plugin, agentReview, cost, error }: ReviewedPlugin,
  choice: PluginChoice | undefined,
): UserPlugin {
  const { installed, parsed } = plugin;
  const enabled = choice?.enabled === true;
  const name = parsed.name ?? installed.name;
  return {
    key: installed.key,
    name,
    marketplace: installed.marketplace,
    version: installed.version,
    description: parsed.description,
    skills: parsed.skills.length,
    commands: parsed.commands.length,
    agents: parsed.agents.length,
    commandNames: pluginCommandNames(name, parsed),
    hooks: parsed.hooks.map(({ event, matcher, command }) => ({ event, matcher, command })),
    mcpServers: parsed.mcpServers.map(({ name, command, args, url }) => ({
      name,
      command,
      args,
      url,
    })),
    loadable: plugin.unloadableReason === null,
    unloadableReason: plugin.unloadableReason,
    fingerprint: plugin.fingerprint,
    scan: {
      status: plugin.status,
      findings: plugin.findings,
      agentReview,
      agentReviewCost: cost,
      agentReviewError: error,
    },
    enabled,
    changed: enabled && !confirmed(plugin, choice),
  };
}
