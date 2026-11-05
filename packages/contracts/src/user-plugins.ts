import { z } from 'zod';
import { fingerprintSchema, repoHookSchema, repoMcpServerSchema } from './agent-config.ts';

export const pluginScanStatusSchema = z.enum(['pending', 'clean', 'review', 'flagged']);
export type PluginScanStatus = z.infer<typeof pluginScanStatusSchema>;

export const pluginFindingSchema = z.object({
  source: z.enum(['check', 'agent']),
  severity: z.enum(['review', 'flagged']),
  rule: z.string(),
  title: z.string().min(1).max(60).optional(),
  file: z.string(),
  line: z.number().int().positive().nullable(),
  reason: z.string(),
});
export type PluginFinding = z.infer<typeof pluginFindingSchema>;

export const userPluginSchema = z.object({
  key: z.string(),
  name: z.string(),
  marketplace: z.string(),
  version: z.string().nullable(),
  description: z.string(),
  skills: z.number().int().nonnegative(),
  commands: z.number().int().nonnegative(),
  agents: z.number().int().nonnegative(),
  commandNames: z.array(z.string()),
  hooks: z.array(repoHookSchema.omit({ source: true })),
  mcpServers: z.array(
    repoMcpServerSchema.pick({ name: true, command: true, args: true, url: true }),
  ),
  loadable: z.boolean(),
  unloadableReason: z.string().nullable(),
  fingerprint: fingerprintSchema,
  scan: z.object({
    status: pluginScanStatusSchema,
    findings: z.array(pluginFindingSchema),
    agentReview: z.enum(['pending', 'done', 'failed', 'off']),
    agentReviewCost: z
      .object({
        tokens: z.number().nonnegative(),
        usd: z.number().nonnegative().nullable(),
      })
      .nullable()
      .optional(),
    agentReviewError: z.string().nullable().optional(),
  }),
  enabled: z.boolean(),
  changed: z.boolean(),
});
export type UserPlugin = z.infer<typeof userPluginSchema>;

export const userPluginsResponseSchema = z.object({
  plugins: z.array(userPluginSchema),
});
export type UserPluginsResponse = z.infer<typeof userPluginsResponseSchema>;

export const userPluginUpdateSchema = z.object({
  enabled: z.boolean(),
  fingerprint: fingerprintSchema,
  confirmFindings: z.boolean().default(false),
});
export type UserPluginUpdate = z.infer<typeof userPluginUpdateSchema>;
