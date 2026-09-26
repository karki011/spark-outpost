import { z } from 'zod';
import { modelRoutingSchema } from './advice.ts';
import { involvementLevelSchema } from './approvals.ts';
import { CONVERSATION_PROJECTS_MAX } from './projects.ts';
import { providerIdSchema } from './setup.ts';

export const capabilityOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().nullable(),
});
export type CapabilityOption = z.infer<typeof capabilityOptionSchema>;

export const providerCapabilitiesSchema = z.object({
  provider: providerIdSchema,
  models: z.array(capabilityOptionSchema),
  efforts: z.array(capabilityOptionSchema),
  defaultModel: z.string().nullable(),
  capturedAt: z.string(),
});
export type ProviderCapabilities = z.infer<typeof providerCapabilitiesSchema>;

export const chatSettingsSchema = z.object({
  provider: providerIdSchema.nullable(),
  model: z.string().nullable(),
  effort: z.string().nullable(),
  permission: z.string().nullable(),
  level: involvementLevelSchema.nullable(),
  routing: modelRoutingSchema.optional(),
});
export type ChatSettings = z.infer<typeof chatSettingsSchema>;

export const updateChatSettingsRequestSchema = z
  .object({
    provider: providerIdSchema,
    model: z.string().min(1).max(200).nullable(),
    effort: z.string().min(1).max(40).nullable(),
    permission: z.string().min(1).max(40).nullable(),
    level: involvementLevelSchema.nullable(),
    routing: modelRoutingSchema,
    projectIds: z
      .array(z.uuid())
      .max(CONVERSATION_PROJECTS_MAX)
      .refine((ids) => new Set(ids).size === ids.length, 'List each project once.'),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one setting to change.');
export type UpdateChatSettingsRequest = z.infer<typeof updateChatSettingsRequestSchema>;
