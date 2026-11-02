import type { Queryable } from '../../persistence/db.ts';
import type { PluginFile } from './files.ts';
import { installedPlugins } from './installed.ts';
import type { ParsedPlugin } from './parse.ts';
import { withAgentReview } from './review-result.ts';
import { loadPluginReviews, reviewKey } from './review-store.ts';
import { scanPlugin, type ScannedPlugin } from './scan.ts';
import { pluginChoices } from './store.ts';
import { pluginLoads } from './view.ts';

export interface UserPluginLaunch {
  key: string;
  name: string;
  fingerprint: string;
  files: PluginFile[];
  parsed: ParsedPlugin;
}

export function pluginLaunch(plugin: ScannedPlugin): UserPluginLaunch {
  return {
    key: plugin.installed.key,
    name: plugin.parsed.name ?? plugin.installed.name,
    fingerprint: plugin.fingerprint,
    files: plugin.files.files,
    parsed: plugin.parsed,
  };
}

export async function loadUserPlugins(
  db: Queryable,
  workspaceId: string,
  configDir: string,
): Promise<UserPluginLaunch[]> {
  const choices = await pluginChoices(db, workspaceId);
  if (![...choices.values()].some((choice) => choice.enabled)) return [];
  const wanted = (await installedPlugins(configDir)).filter(
    (installed) => choices.get(installed.key)?.enabled === true,
  );
  const [scanned, reviews] = await Promise.all([
    Promise.all(wanted.map(scanPlugin)),
    loadPluginReviews(db, workspaceId),
  ]);
  return scanned
    .map(
      (plugin) =>
        withAgentReview(plugin, reviews.get(reviewKey(plugin.installed.key, plugin.fingerprint)))
          .plugin,
    )
    .filter((plugin) => pluginLoads(plugin, choices.get(plugin.installed.key)))
    .map(pluginLaunch);
}
