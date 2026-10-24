import { z } from 'zod';

export const RULE_EFFECT_NAMES = ['allow', 'ask', 'deny'] as const;
export const ruleEffectSchema = z.enum(RULE_EFFECT_NAMES);
export type RuleEffectName = z.infer<typeof ruleEffectSchema>;

export const rulesTargetSchema = z.enum(['user', 'managed']);
export type RulesTarget = z.infer<typeof rulesTargetSchema>;

export const RULES_EDIT_MAX = 50;
export const RULE_TEXT_MAX = 512;

export const ruleLineSchema = z.object({
  effect: ruleEffectSchema,
  rule: z.string().min(1).max(RULE_TEXT_MAX),
});
export type RuleLine = z.infer<typeof ruleLineSchema>;

export const RULES_FILE_NAMES: Record<RulesTarget, string> = {
  user: 'settings.json',
  managed: 'managed-settings.json',
};

export const rulesEditActionSchema = z.object({
  action: z.literal('rules_edit'),
  target: rulesTargetSchema,
  add: z.array(ruleLineSchema).max(RULES_EDIT_MAX),
  remove: z.array(ruleLineSchema).max(RULES_EDIT_MAX),
  fileHash: z.string().max(100),
  agent: z.string().max(100),
  modeName: z.string().max(100),
  provider: z.string().max(100),
  agentMode: z.string().max(100).nullable(),
  sessionRow: z.uuid().nullable(),
});
export type RulesEditAction = z.infer<typeof rulesEditActionSchema>;

export const RULES_SESSION_OPTION = 'session';
export const RULES_SESSION_LABEL = 'Allow for this session';
export const RULES_ONCE_LABEL = 'Allow once';
export const RULES_DENY_LABEL = 'Deny';

export const rulesEditLabels = {
  rules_edit: {
    question: 'Change your Spark rules?',
    confirm: RULES_ONCE_LABEL,
    doing: 'Changing the rules…',
  },
};

export function rulesEditQuestion(action: RulesEditAction): string {
  return action.target === 'managed'
    ? 'Change your company’s rules?'
    : rulesEditLabels.rules_edit.question;
}

export function rulesEditByline(action: RulesEditAction): string {
  return `${action.agent} · ${action.modeName} wants to edit ${RULES_FILE_NAMES[action.target]}`;
}

export function rulesEditNote(action: RulesEditAction): string {
  return action.target === 'managed'
    ? 'macOS then asks for an admin password. You type it; Spark never sees it.'
    : 'Asks again if you switch the agent or its mode.';
}

export function rulesEditAuditFacts(action: RulesEditAction): Record<string, unknown> {
  return {
    action: action.action,
    target: action.target,
    add: action.add,
    remove: action.remove,
    provider: action.provider,
    agentMode: action.agentMode,
  };
}

export const outsideChangeSchema = z.object({
  fileHash: z.string(),
  added: z.array(ruleLineSchema),
  removed: z.array(ruleLineSchema),
});
export type OutsideChangeView = z.infer<typeof outsideChangeSchema>;

export const outsideChangeAnswerSchema = z.object({
  keep: z.enum(['file', 'spark']),
  fileHash: z.string().max(100),
});
export type OutsideChangeAnswer = z.infer<typeof outsideChangeAnswerSchema>;
