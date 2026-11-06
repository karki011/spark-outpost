import { z } from 'zod';
import { type ProviderId } from './provider-ids.ts';

export const MODEL_AVAILABILITIES = ['usable', 'unknown', 'unusable'] as const;
export const modelAvailabilitySchema = z.enum(MODEL_AVAILABILITIES);
export type ModelAvailability = z.infer<typeof modelAvailabilitySchema>;

export const ACCOUNT_KINDS = ['account', 'api_key', 'gateway', 'external', 'none'] as const;
export const accountKindSchema = z.enum(ACCOUNT_KINDS);
export type AccountKind = z.infer<typeof accountKindSchema>;

export const providerAccountSchema = z.object({
  kind: accountKindSchema,
  label: z.string().max(120),
  plan: z.string().max(60).nullable(),
});
export type ProviderAccount = z.infer<typeof providerAccountSchema>;

export const modelRefSchema = z.object({ id: z.string(), label: z.string() });
export type ModelRef = z.infer<typeof modelRefSchema>;

export const defaultModelIssueSchema = z.object({
  model: modelRefSchema,
  suggestion: modelRefSchema.nullable(),
});
export type DefaultModelIssue = z.infer<typeof defaultModelIssueSchema>;

export const providerAccessSchema = z.object({
  account: providerAccountSchema.nullable(),
  signIn: z.string(),
  reported: z.boolean(),
  usable: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  unusable: z.array(modelRefSchema),
  checkedAt: z.string().nullable(),
  defaultIssue: defaultModelIssueSchema.nullable(),
});
export type ProviderAccess = z.infer<typeof providerAccessSchema>;

export const MODEL_SWITCH_ACTIVITY = 'model_switch';

export const modelSwitchSchema = z.object({
  provider: z.string(),
  signIn: z.string(),
  from: modelRefSchema,
  to: modelRefSchema.nullable(),
  learned: z.boolean(),
});
export type ModelSwitch = z.infer<typeof modelSwitchSchema>;

const ACCOUNT_SIGN_IN: Record<ProviderId, string> = {
  claude: 'Claude',
  codex: 'ChatGPT',
  zai: 'Z.ai',
  custom: 'Custom endpoint',
};

export function signInName(
  provider: ProviderId,
  providerName: string,
  account: Pick<ProviderAccount, 'kind'> | null,
): string {
  if (account?.kind === 'account') return `${ACCOUNT_SIGN_IN[provider]} sign-in`;
  if (account?.kind === 'api_key') return `${providerName} API key`;
  return `${providerName} sign-in`;
}

export function modelSwitchText(change: ModelSwitch): string {
  const cannot = `Your ${change.signIn} can't use ${change.from.label}`;
  return change.to ? `${cannot}, so this turn ran on ${change.to.label} instead.` : `${cannot}.`;
}

export function unavailableText(signIn: string, model: string): string {
  return `Your ${signIn} can't use ${model}.`;
}
