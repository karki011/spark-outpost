import { z } from 'zod';
import {
  pluginsAnswerLabels,
  SPARK_ACTION_KIND,
  SPARK_ACTION_OPTION,
  type ApprovalOption,
  type PluginsEditAction,
} from '@spark-outpost/contracts';
import {
  findPlugin,
  loadUserPlugins,
  PLUGIN_GONE,
  PLUGIN_REVIEW_RUNNING,
} from '../../agent-config/user-plugins/choice.ts';
import type { ReviewedPlugin } from '../../agent-config/user-plugins/review-result.ts';
import { pluginConfirmed } from '../../agent-config/user-plugins/view.ts';
import type { Queryable } from '../../persistence/db.ts';
import { actionRun, proposeAction, WAITING_MESSAGE } from '../actions/confirm.ts';
import {
  rulesRunRefusal,
  rulesSession,
  type RulesRefusedRun,
} from '../actions/rules-edit-session.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';

export const PLUGINS_EDIT_TOOL = 'spark_plugins_edit';

function pluginsOptions(enabled: boolean): ApprovalOption[] {
  const labels = pluginsAnswerLabels(enabled);
  return [
    { optionId: SPARK_ACTION_OPTION.confirm, name: labels.confirm, kind: 'allow_once' },
    { optionId: SPARK_ACTION_OPTION.decline, name: labels.decline, kind: 'reject_once' },
  ];
}

export const PLUGINS_RUN_REFUSALS: Record<RulesRefusedRun, string> = {
  remote:
    'Plugins are never turned on or off from a turn started on a paired device. Ask from the Mac.',
  voice: 'Plugins are never turned on or off from a spoken message. Type it on the Mac instead.',
  child: 'Only the chat’s own turn can ask to turn a plugin on or off.',
  assistant: 'Ask Spark does not turn plugins on or off. Ask in a chat on the Mac.',
  read_only: 'This turn is read-only, so it cannot turn a plugin on or off.',
  no_chat: 'Plugins are turned on or off only from a chat turn.',
};

const ITEMS_MAX = 100;
const TEXT_MAX = 2_000;

function clip(text: string): string {
  return text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX - 1)}…` : text;
}

function inlineShell(found: ReviewedPlugin) {
  const { files } = found.plugin.files;
  return found.plugin.findings
    .filter((finding) => finding.rule === 'inline-shell' && finding.line !== null)
    .slice(0, ITEMS_MAX)
    .map((finding) => {
      const text = files.find((file) => file.path === finding.file)?.text ?? '';
      const line = text.split('\n')[finding.line! - 1] ?? '';
      return { file: clip(finding.file), line: finding.line!, text: clip(line.trim()) };
    });
}

interface CardSession {
  agent: string;
  modeName: string;
}

export function pluginCard(
  found: ReviewedPlugin,
  enabled: boolean,
  session: CardSession,
): PluginsEditAction {
  const { plugin, agentReview } = found;
  const { installed, parsed } = plugin;
  return {
    action: 'plugins_edit',
    key: installed.key,
    name: parsed.name ?? installed.name,
    version: installed.version,
    enabled,
    fingerprint: plugin.fingerprint,
    status: plugin.status,
    agentReview,
    hold: enabled && plugin.status !== 'clean',
    findings: plugin.findings.slice(0, ITEMS_MAX).map((finding) => ({
      ...finding,
      file: clip(finding.file),
      reason: clip(finding.reason),
    })),
    hooks: parsed.hooks.slice(0, ITEMS_MAX).map((hook) => ({
      event: clip(hook.event),
      matcher: hook.matcher === null ? null : clip(hook.matcher),
      command: clip(hook.command),
    })),
    inlineShell: inlineShell(found),
    mcpServers: parsed.mcpServers.slice(0, ITEMS_MAX).map((server) => ({
      name: clip(server.name),
      target: clip(server.url ?? [server.command ?? '', ...server.args].join(' ').trim()),
    })),
    agent: session.agent,
    modeName: session.modeName,
  };
}

async function waitingCard(
  db: Queryable,
  conversationId: string,
  action: PluginsEditAction,
): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT a.id FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1 AND a.kind = $2 AND a.status = 'pending'
       AND a.payload->'sparkAction'->>'action' = 'plugins_edit'
       AND a.payload->'sparkAction'->>'key' = $3
       AND (a.payload->'sparkAction'->>'enabled')::boolean = $4
       AND a.payload->'sparkAction'->>'fingerprint' = $5
     ORDER BY a.created_at DESC LIMIT 1`,
    [conversationId, SPARK_ACTION_KIND, action.key, action.enabled, action.fingerprint],
  );
  return rows[0]?.id ?? null;
}

function proposalRefusal(found: ReviewedPlugin, enabled: boolean): string | null {
  if (!enabled) return null;
  if (found.plugin.unloadableReason) return found.plugin.unloadableReason;
  if (found.agentReview === 'pending') return PLUGIN_REVIEW_RUNNING;
  return null;
}

interface EditArgs {
  key: string;
  enabled: boolean;
}

async function edit(args: EditArgs, context: SparkToolContext) {
  const run = actionRun(context.scope);
  const { db } = context.deps;
  const refusedRun = await rulesRunRefusal(db, context.scope);
  if (refusedRun) throw new SparkToolError(PLUGINS_RUN_REFUSALS[refusedRun]);
  const session = await rulesSession(db, run.runId);
  if (!session) throw new SparkToolError(PLUGINS_RUN_REFUSALS.no_chat);
  const { plugins, choices } = await loadUserPlugins(db, context.scope.workspaceId, false);
  const found = findPlugin(plugins, args.key);
  if (!found) throw new SparkToolError(PLUGIN_GONE);
  const choice = choices.get(args.key);
  const alreadyOn = pluginConfirmed(found.plugin, choice);
  const alreadyOff = choice?.enabled !== true;
  if (args.enabled ? alreadyOn : alreadyOff) {
    return { outcome: 'unchanged', message: `It is already ${args.enabled ? 'on' : 'off'}.` };
  }
  const refused = proposalRefusal(found, args.enabled);
  if (refused) throw new SparkToolError(refused);
  const action = pluginCard(found, args.enabled, session);
  const conversationId = context.scope.conversationId!;
  const waiting = await waitingCard(db, conversationId, action);
  if (waiting) {
    return { outcome: 'waiting_for_user', approvalId: waiting, message: WAITING_MESSAGE };
  }
  return proposeAction(context, action, {
    path: 'confirm',
    options: pluginsOptions(args.enabled),
    audit: { floor: 'spark_plugins' },
  });
}

export const pluginsEditTool = sparkTool({
  name: PLUGINS_EDIT_TOOL,
  needs: 'plugins_edit',
  acts: true,
  title: 'Turn a Claude plugin on or off',
  description:
    'Only when the user asks: turns a Claude Code plugin (key from spark_settings) on or off for Claude chats. Always a card.',
  input: {
    key: z.string().min(1).max(300),
    enabled: z.boolean(),
  },
  run: (args, context) => edit(args, context),
});
