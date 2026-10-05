import { z } from 'zod';
import { modelRoutingSchema } from './advice.ts';
import {
  agentModeOptionSchema,
  configOptionInfoSchema,
  configValuesSchema,
} from './agent-modes.ts';
import { involvementLevelSchema } from './involvement-levels.ts';
import { modelAvailabilitySchema, modelRefSchema, providerAccessSchema } from './model-access.ts';
import { CONVERSATION_PROJECTS_MAX } from './projects.ts';
import { providerIdSchema } from './setup.ts';

export const capabilityOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().nullable(),
});
export type CapabilityOption = z.infer<typeof capabilityOptionSchema>;

export const modelOptionSchema = capabilityOptionSchema.extend({
  retiresNotBefore: z.string().nullable().optional(),
  retired: z.boolean().optional(),
  availability: modelAvailabilitySchema.optional(),
  switchTo: modelRefSchema.nullable().optional(),
});
export type ModelOption = z.infer<typeof modelOptionSchema>;

export const RETIRING_WITHIN_DAYS = 30;
const DAY_MS = 86_400_000;

export type RetirementState = 'retiring' | 'retired';

type Retiree = Pick<ModelOption, 'retiresNotBefore' | 'retired'>;

export function retirementState(model: Retiree, now: Date): RetirementState | null {
  if (model.retired) return 'retired';
  if (!model.retiresNotBefore) return null;
  const left = Date.parse(`${model.retiresNotBefore}T00:00:00Z`) - now.getTime();
  if (left <= -DAY_MS) return 'retired';
  return left <= RETIRING_WITHIN_DAYS * DAY_MS ? 'retiring' : null;
}

export function isRetiring(model: Retiree, now: Date): boolean {
  return retirementState(model, now) !== null;
}

export const providerCapabilitiesSchema = z.object({
  provider: providerIdSchema,
  models: z.array(modelOptionSchema),
  efforts: z.array(capabilityOptionSchema),
  defaultModel: z.string().nullable(),
  agentDefaultModel: z.string().nullable().optional(),
  modes: z.array(agentModeOptionSchema).default([]),
  defaultMode: z.string().nullable().default(null),
  options: z.array(configOptionInfoSchema).default([]),
  capturedAt: z.string(),
  access: providerAccessSchema.nullable().optional(),
});
export type ProviderCapabilities = z.infer<typeof providerCapabilitiesSchema>;

export const chatSettingsSchema = z.object({
  provider: providerIdSchema.nullable(),
  model: z.string().nullable(),
  effort: z.string().nullable(),
  permission: z.string().nullable(),
  agentMode: z.string().nullable().default(null),
  level: involvementLevelSchema.nullable(),
  options: configValuesSchema.default({}),
  routing: modelRoutingSchema.optional(),
});
export type ChatSettings = z.infer<typeof chatSettingsSchema>;

export const updateChatSettingsRequestSchema = z
  .object({
    provider: providerIdSchema,
    model: z.string().min(1).max(200).nullable(),
    effort: z.string().min(1).max(40).nullable(),
    agentMode: z.string().min(1).max(200).nullable(),
    level: involvementLevelSchema.nullable(),
    options: configValuesSchema,
    routing: modelRoutingSchema,
    projectIds: z
      .array(z.uuid())
      .max(CONVERSATION_PROJECTS_MAX)
      .refine((ids) => new Set(ids).size === ids.length, 'List each project once.'),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one setting to change.');
export type UpdateChatSettingsRequest = z.infer<typeof updateChatSettingsRequestSchema>;
