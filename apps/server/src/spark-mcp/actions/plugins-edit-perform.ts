import type { PluginsEditAction } from '@spark-outpost/contracts';
import {
  applyPluginChoice,
  findPlugin,
  loadUserPlugins,
  PLUGIN_GONE,
  PLUGIN_REVIEW_RUNNING,
} from '../../agent-config/user-plugins/choice.ts';
import type { ReviewedPlugin } from '../../agent-config/user-plugins/review-result.ts';
import type { SparkToolContext } from '../tool.ts';
import type { Performed } from './performed.ts';

export const PLUGIN_CHANGED_SINCE_CARD =
  'The plugin changed since the card was shown, so Spark changed nothing. Ask again to see it as it is now.';
export const PLUGIN_REVIEW_CHANGED =
  'The agent review of this plugin changed since the card was shown, so Spark changed nothing. Ask again to see what it found.';

export function pluginRecheck(
  found: ReviewedPlugin | undefined,
  action: PluginsEditAction,
): string | null {
  if (!found) return PLUGIN_GONE;
  if (found.plugin.fingerprint !== action.fingerprint) return PLUGIN_CHANGED_SINCE_CARD;
  if (action.enabled && found.agentReview === 'pending') return PLUGIN_REVIEW_RUNNING;
  if (found.agentReview !== action.agentReview || found.plugin.status !== action.status) {
    return PLUGIN_REVIEW_CHANGED;
  }
  return null;
}

export async function performPluginsEdit(
  context: SparkToolContext,
  action: PluginsEditAction,
): Promise<Performed> {
  const { db } = context.deps;
  const { workspaceId, conversationId } = context.scope;
  const { plugins } = await loadUserPlugins(db, workspaceId, false);
  const found = findPlugin(plugins, action.key);
  const refused = pluginRecheck(found, action);
  if (refused) throw new Error(refused);
  await applyPluginChoice(db, workspaceId, found, {
    enabled: action.enabled,
    fingerprint: action.fingerprint,
    confirmFindings: action.hold,
    by: { chat: conversationId ?? '', agent: action.agent },
  });
  const state = action.enabled ? 'on for Claude chats' : 'off';
  return { message: `Turned ${action.name} ${state}.`, url: null };
}
