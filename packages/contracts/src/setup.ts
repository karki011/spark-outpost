import { z } from 'zod';
import { providerIdSchema, type ProviderId } from './provider-ids.ts';
import type { TeammateBrief } from './teammates.ts';
import { DEFAULT_INVOLVEMENT_LEVEL } from './approvals.ts';
import { involvementLevelSchema } from './involvement-levels.ts';
import {
  COMPACT_AT_DEFAULT,
  COMPACT_WARN_DEFAULT,
  compactAtPercentSchema,
  compactWarnPercentSchema,
} from './compaction.ts';
import {
  DEFAULT_MORNING_BRIEF_TIME,
  DEFAULT_PERSONALITY,
  morningBriefTimeSchema,
  personalitySchema,
} from './spark.ts';

export { providerIdSchema, type ProviderId };

export const advisorIdSchema = z.enum(['jev']);
export type AdvisorId = z.infer<typeof advisorIdSchema>;

export const connectableIdSchema = z.enum([
  ...providerIdSchema.options,
  ...advisorIdSchema.options,
]);
export type ConnectableId = z.infer<typeof connectableIdSchema>;

export const connectionMethodSchema = z.enum(['cli', 'api_key']);
export type ConnectionMethod = z.infer<typeof connectionMethodSchema>;

export const DISPLAY_NAME_MAX_LENGTH = 40;

export const choiceSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  risky: z.boolean().default(false),
  unavailableReason: z.string().nullable().default(null),
});
export type Choice = z.infer<typeof choiceSchema>;

export const modelSchema = z.object({ id: z.string(), label: z.string() });

export const keyLinkSchema = z.object({ text: z.string(), url: z.url() });
export type KeyLink = z.infer<typeof keyLinkSchema>;
export type ProviderModel = z.infer<typeof modelSchema>;

export const connectionTestSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  testedAt: z.string(),
});
export type ConnectionTest = z.infer<typeof connectionTestSchema>;

export const providerConnectionSchema = z.object({
  method: connectionMethodSchema,
  detail: z.string(),
  summary: z.string().nullable(),
  lastTest: connectionTestSchema.nullable(),
  models: z.array(modelSchema),
  model: z.string().nullable(),
  permission: z.string(),
  agentMode: z.string().nullable().default(null),
  effort: z.string().nullable(),
  verifiedAt: z.string(),
});
export type ProviderConnection = z.infer<typeof providerConnectionSchema>;

export const advisorConnectionSchema = providerConnectionSchema.pick({
  method: true,
  detail: true,
  summary: true,
  models: true,
  model: true,
  verifiedAt: true,
});
export type AdvisorConnection = z.infer<typeof advisorConnectionSchema>;

const connectableSetupSchema = z.object({
  id: connectableIdSchema,
  name: z.string(),
  maker: z.string(),
  cli: z.string(),
  keyPrefix: z.string(),
  keyHint: z.string(),
  keyLink: keyLinkSchema.nullable(),
  methods: z.array(connectionMethodSchema),
  connection: advisorConnectionSchema.nullable(),
});
export type ConnectableSetup = z.infer<typeof connectableSetupSchema>;

export const providerSetupSchema = connectableSetupSchema.extend({
  id: providerIdSchema,
  note: z.string().nullable(),
  installCommand: z.string(),
  efforts: z.array(choiceSchema),
  defaultEffort: z.string(),
  connection: providerConnectionSchema.nullable(),
});
export type ProviderSetup = z.infer<typeof providerSetupSchema>;

export const advisorSetupSchema = connectableSetupSchema.extend({
  id: advisorIdSchema,
  role: z.string(),
});
export type AdvisorSetup = z.infer<typeof advisorSetupSchema>;

export const DEFAULT_AUTO_CONTINUE_SECONDS = 60;
export const AUTO_CONTINUE_CHOICES: readonly (number | null)[] = [30, 60, 120, 300, null];
export const AUTO_CONTINUE_CUSTOM_MIN_SECONDS = 5;
export const AUTO_CONTINUE_MAX_SECONDS = 600;
export const autoContinueSecondsSchema = z
  .number()
  .int()
  .min(1)
  .max(AUTO_CONTINUE_MAX_SECONDS)
  .nullable();

export const WIDE_WINDOW_LAYOUTS = ['rail', 'panel', 'empty'] as const;
export const wideWindowSchema = z.enum(WIDE_WINDOW_LAYOUTS);
export type WideWindowLayout = z.infer<typeof wideWindowSchema>;
export const DEFAULT_WIDE_WINDOW: WideWindowLayout = 'rail';

export const busyEnterSchema = z.enum(['queue', 'now']);
export type BusyEnterAction = z.infer<typeof busyEnterSchema>;
export const DEFAULT_BUSY_ENTER: BusyEnterAction = 'queue';

export const profileSchema = z.object({
  displayName: z.string(),
  defaultProvider: providerIdSchema.nullable(),
  onboardingCompleted: z.boolean(),
  autoContinueSeconds: autoContinueSecondsSchema.default(DEFAULT_AUTO_CONTINUE_SECONDS),
  prReadyForReview: z.boolean().default(true),
  prFollowUp: z.boolean().default(true),
  prFollowUpChecks: z.boolean().default(true),
  prFollowUpReviews: z.boolean().default(true),
  prFollowUpReplies: z.boolean().default(true),
  prFollowUpAsk: z.boolean().default(false),
  personality: personalitySchema.default(DEFAULT_PERSONALITY),
  agentInstructions: z.string().max(8000).optional(),
  agentInstructionsFile: z.string().max(4096).optional(),
  agentInstructionsFileSet: z.boolean().optional(),
  agentInstructionsFileError: z.string().nullable().optional(),
  defaultLevel: involvementLevelSchema.default(DEFAULT_INVOLVEMENT_LEVEL),
  defaultLevelNotice: z.boolean().default(false),
  morningBrief: z.boolean().default(true),
  morningBriefTime: morningBriefTimeSchema.default(DEFAULT_MORNING_BRIEF_TIME),
  compactWarnPercent: compactWarnPercentSchema.default(COMPACT_WARN_DEFAULT),
  compactAtPercent: compactAtPercentSchema.default(COMPACT_AT_DEFAULT),
  autoCompact: z.boolean().default(true),
  heartbeat: z.boolean().default(true),
  wideWindow: wideWindowSchema.default(DEFAULT_WIDE_WINDOW),
  busyEnter: busyEnterSchema.default(DEFAULT_BUSY_ENTER),
  terminalRecordLikeChat: z.boolean().default(false),
});
export type Profile = z.infer<typeof profileSchema>;
export type SparkSessionPrefs = Pick<
  Profile,
  'displayName' | 'personality' | 'agentInstructions'
> & {
  teammate?: TeammateBrief | null;
  chatPrompt?: string | null;
};

export const setupStateSchema = z.object({
  profile: profileSchema,
  providers: z.array(providerSetupSchema),
  advisors: z.array(advisorSetupSchema),
});
export type SetupState = z.infer<typeof setupStateSchema>;

export const updateProfileRequestSchema = z
  .object({
    displayName: z.string().max(DISPLAY_NAME_MAX_LENGTH),
    defaultProvider: providerIdSchema,
    onboardingCompleted: z.literal(true),
    autoContinueSeconds: autoContinueSecondsSchema,
    prReadyForReview: z.boolean(),
    prFollowUp: z.boolean(),
    prFollowUpChecks: z.boolean(),
    prFollowUpReviews: z.boolean(),
    prFollowUpReplies: z.boolean(),
    prFollowUpAsk: z.boolean(),
    personality: personalitySchema,
    agentInstructions: z.string().max(8000),
    agentInstructionsFile: z.string().max(4096),
    defaultLevel: involvementLevelSchema,
    defaultLevelNotice: z.literal(false),
    morningBrief: z.boolean(),
    morningBriefTime: morningBriefTimeSchema,
    compactWarnPercent: compactWarnPercentSchema,
    compactAtPercent: compactAtPercentSchema,
    autoCompact: z.boolean(),
    heartbeat: z.boolean(),
    wideWindow: wideWindowSchema,
    busyEnter: busyEnterSchema,
    terminalRecordLikeChat: z.boolean(),
  })
  .partial();
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

export const updateProviderDefaultsRequestSchema = z
  .object({
    model: z.string(),
    agentMode: z.string().min(1).max(200),
    effort: z.string().min(1).max(40).nullable(),
  })
  .partial();
export type UpdateProviderDefaultsRequest = z.infer<typeof updateProviderDefaultsRequestSchema>;

export const verifyRequestSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('cli') }),
  z.object({ method: z.literal('api_key'), apiKey: z.string().trim().min(1).max(512) }),
]);
export type VerifyRequest = z.infer<typeof verifyRequestSchema>;

export const verifyFailureCodeSchema = z.enum(['cli_missing', 'not_logged_in']);
export type VerifyFailureCode = z.infer<typeof verifyFailureCodeSchema>;

export const verifyEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('step_started'), label: z.string() }),
  z.object({ type: z.literal('step_succeeded'), label: z.string() }),
  z.object({
    type: z.literal('step_failed'),
    label: z.string(),
    code: verifyFailureCodeSchema.optional(),
  }),
  z.object({
    type: z.literal('connected'),
    connection: z.union([providerConnectionSchema, advisorConnectionSchema]),
  }),
]);
export type VerifyEvent = z.infer<typeof verifyEventSchema>;

export type KeyHintTone = 'neutral' | 'bad' | 'good';

export interface KeyHint {
  tone: KeyHintTone;
  message: string;
  valid: boolean;
}

const MIN_KEY_LENGTH = 24;

export function apiKeyHint(
  provider: Pick<ConnectableSetup, 'id' | 'name' | 'keyPrefix' | 'keyHint'>,
  rawKey: string,
): KeyHint {
  const key = rawKey.trim();
  if (!key) return { tone: 'neutral', message: provider.keyHint, valid: false };
  if ((provider.id === 'codex' || provider.id === 'zai') && key.startsWith('sk-ant-')) {
    return {
      tone: 'bad',
      message: 'This looks like an Anthropic key. Paste it under Claude instead.',
      valid: false,
    };
  }
  if (provider.id === 'zai' && key.startsWith('sk-')) {
    return {
      tone: 'bad',
      message: 'This looks like an OpenAI key. Paste it under Codex instead.',
      valid: false,
    };
  }
  if (!provider.keyPrefix) {
    return { tone: 'good', message: 'Verify to finish connecting.', valid: true };
  }
  if (!key.startsWith(provider.keyPrefix)) {
    return {
      tone: 'bad',
      message: `${provider.name} keys start with ${provider.keyPrefix}`,
      valid: false,
    };
  }
  if (key.length < MIN_KEY_LENGTH) {
    return {
      tone: 'bad',
      message: 'This key looks too short. Make sure you copied all of it.',
      valid: false,
    };
  }
  return { tone: 'good', message: 'Looks right. Verify to finish connecting.', valid: true };
}

export function maskApiKey(key: string, shownPrefixLength = 7): string {
  const trimmed = key.trim();
  return `${trimmed.slice(0, shownPrefixLength)}…${trimmed.slice(-4)}`;
}
