import type { Db } from '../../persistence/db.ts';
import { claudeConfigDir } from '../permission-rules.ts';
import { requestPluginReviews } from './review.ts';
import { withAgentReview, type ReviewedPlugin } from './review-result.ts';
import { loadPluginReviews, reviewKey } from './review-store.ts';
import { scanUserPlugins } from './scan.ts';
import { pluginChoices, setPluginChoice, type PluginChoice, type PluginChooser } from './store.ts';

export type PluginChoiceProblem = 'invalid' | 'conflict';

export class PluginChoiceError extends Error {
  constructor(
    message: string,
    readonly problem: PluginChoiceProblem,
  ) {
    super(message);
  }
}

export const PLUGIN_GONE = 'That plugin is no longer installed.';
export const PLUGIN_CHANGED =
  'This plugin changed since you reviewed it. Review it again before turning it on.';
export const PLUGIN_REVIEW_RUNNING =
  'The agent review of this plugin is still running. Try again when it finishes.';
export const PLUGIN_FINDINGS =
  'This plugin has findings to review. Confirm them before turning it on.';

export interface LoadedPlugins {
  plugins: ReviewedPlugin[];
  choices: Map<string, PluginChoice>;
}

export async function loadUserPlugins(
  db: Db,
  workspaceId: string,
  requestReviews: boolean,
): Promise<LoadedPlugins> {
  const [scanned, choices] = await Promise.all([
    scanUserPlugins(claudeConfigDir(process.env)),
    pluginChoices(db, workspaceId),
  ]);
  if (requestReviews) {
    await requestPluginReviews(db, workspaceId, scanned).catch((error: unknown) =>
      console.error('Could not start the agent reviews of plugins', error),
    );
  }
  const reviews = await loadPluginReviews(db, workspaceId);
  const plugins = scanned.map((plugin) =>
    withAgentReview(plugin, reviews.get(reviewKey(plugin.installed.key, plugin.fingerprint))),
  );
  return { plugins, choices };
}

export function findPlugin(plugins: readonly ReviewedPlugin[], key: string) {
  return plugins.find((candidate) => candidate.plugin.installed.key === key);
}

export interface PluginChange {
  enabled: boolean;
  fingerprint: string;
  confirmFindings: boolean;
  by?: PluginChooser;
}

function refusal(found: ReviewedPlugin, change: PluginChange): PluginChoiceError | null {
  const { plugin } = found;
  if (plugin.unloadableReason) return new PluginChoiceError(plugin.unloadableReason, 'invalid');
  if (change.fingerprint !== plugin.fingerprint) {
    return new PluginChoiceError(PLUGIN_CHANGED, 'conflict');
  }
  if (found.agentReview === 'pending') {
    return new PluginChoiceError(PLUGIN_REVIEW_RUNNING, 'conflict');
  }
  if (plugin.status !== 'clean' && !change.confirmFindings) {
    return new PluginChoiceError(PLUGIN_FINDINGS, 'conflict');
  }
  return null;
}

export async function applyPluginChoice(
  db: Db,
  workspaceId: string,
  found: ReviewedPlugin | undefined,
  change: PluginChange,
): Promise<void> {
  if (!found) throw new PluginChoiceError(PLUGIN_GONE, 'invalid');
  const refused = change.enabled ? refusal(found, change) : null;
  if (refused) throw refused;
  await setPluginChoice(db, workspaceId, found.plugin, change);
}
