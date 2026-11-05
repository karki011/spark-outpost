import { z } from 'zod';
import { fingerprintSchema } from './agent-config.ts';
import { pluginFindingSchema, pluginScanStatusSchema, userPluginSchema } from './user-plugins.ts';

const CARD_ITEMS_MAX = 100;
const CARD_TEXT_MAX = 2_000;

const cardText = z.string().max(CARD_TEXT_MAX);

export const pluginsEditActionSchema = z.object({
  action: z.literal('plugins_edit'),
  key: z.string().max(300),
  name: z.string().max(300),
  version: z.string().max(100).nullable(),
  enabled: z.boolean(),
  fingerprint: fingerprintSchema,
  status: pluginScanStatusSchema,
  agentReview: userPluginSchema.shape.scan.shape.agentReview,
  hold: z.boolean(),
  findings: z.array(pluginFindingSchema).max(CARD_ITEMS_MAX),
  hooks: z
    .array(z.object({ event: cardText, matcher: cardText.nullable(), command: cardText }))
    .max(CARD_ITEMS_MAX),
  inlineShell: z
    .array(z.object({ file: cardText, line: z.number().int().positive(), text: cardText }))
    .max(CARD_ITEMS_MAX),
  mcpServers: z.array(z.object({ name: cardText, target: cardText })).max(CARD_ITEMS_MAX),
  agent: z.string().max(100),
  modeName: z.string().max(100),
});
export type PluginsEditAction = z.infer<typeof pluginsEditActionSchema>;

export const PLUGINS_ANSWER_LABELS = {
  on: { confirm: 'Turn on', decline: 'Don’t turn on' },
  off: { confirm: 'Turn off', decline: 'Keep on' },
} as const;

export function pluginsAnswerLabels(enabled: boolean) {
  return PLUGINS_ANSWER_LABELS[enabled ? 'on' : 'off'];
}

export const pluginsEditLabels = {
  plugins_edit: {
    question: 'Turn this plugin on?',
    confirm: PLUGINS_ANSWER_LABELS.on.confirm,
    doing: 'Changing the plugin…',
  },
};

export function pluginsEditQuestion(action: PluginsEditAction): string {
  const verb = action.enabled ? 'on' : 'off';
  return `Turn ${verb} “${action.name}” for Claude chats?`;
}

export function pluginsEditByline(action: PluginsEditAction): string {
  return `${action.agent} · ${action.modeName}`;
}

export const PLUGINS_EDIT_NOTE = 'Only you can answer this, on your Mac.';

export function pluginsEditAuditFacts(action: PluginsEditAction): Record<string, unknown> {
  return {
    action: action.action,
    key: action.key,
    enabled: action.enabled,
    fingerprint: action.fingerprint,
    status: action.status,
    agentReview: action.agentReview,
    findings: action.findings.length,
    agent: action.agent,
    modeName: action.modeName,
  };
}
