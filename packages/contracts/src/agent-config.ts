import { z } from 'zod';

export const AGENT_CONFIG_SWITCHES = ['instructions', 'skills', 'commands', 'subagents'] as const;
export const agentConfigSwitchSchema = z.enum(AGENT_CONFIG_SWITCHES);
export type AgentConfigSwitch = z.infer<typeof agentConfigSwitchSchema>;

export const repoInstructionFileSchema = z.object({
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  nested: z.boolean(),
});
export type RepoInstructionFile = z.infer<typeof repoInstructionFileSchema>;

export const repoDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  path: z.string(),
});
export type RepoDefinition = z.infer<typeof repoDefinitionSchema>;

export const repoHookSchema = z.object({
  event: z.string(),
  matcher: z.string().nullable(),
  command: z.string(),
  source: z.string(),
});
export type RepoHook = z.infer<typeof repoHookSchema>;

export const mcpTransportSchema = z.enum(['stdio', 'http', 'sse']);
export type McpTransport = z.infer<typeof mcpTransportSchema>;

export const mcpServerSourceSchema = z.union([
  z.literal('project'),
  z.literal('user'),
  z.string().regex(/^imported:[a-z0-9-]+$/),
]);
export type McpServerSource = z.infer<typeof mcpServerSourceSchema>;

export const mcpScopeSchema = z.enum(['global', 'project', 'chat']);
export type McpScope = z.infer<typeof mcpScopeSchema>;

export const repoMcpServerSchema = z.object({
  name: z.string(),
  transport: mcpTransportSchema,
  command: z.string().nullable(),
  args: z.array(z.string()),
  url: z.string().nullable(),
  envNames: z.array(z.string()),
  headerNames: z.array(z.string()),
  fingerprint: z.string(),
  enabled: z.boolean(),
  changed: z.boolean(),
});
export type RepoMcpServer = z.infer<typeof repoMcpServerSchema>;

export const ignoredSettingSchema = z.object({
  source: z.string(),
  kind: z.enum(['allow', 'env', 'command', 'setting', 'codex']),
  items: z.array(z.string()),
});
export type IgnoredSetting = z.infer<typeof ignoredSettingSchema>;

export const agentConfigSettingsSchema = z.object({
  instructions: z.boolean(),
  skills: z.boolean(),
  commands: z.boolean(),
  subagents: z.boolean(),
  hooks: z.boolean(),
  hooksChanged: z.boolean(),
});
export type AgentConfigSettings = z.infer<typeof agentConfigSettingsSchema>;

export const repoAgentConfigSchema = z.object({
  projectId: z.uuid(),
  rootPath: z.string(),
  settings: agentConfigSettingsSchema,
  instructions: z.array(repoInstructionFileSchema),
  skills: z.array(repoDefinitionSchema),
  commands: z.array(repoDefinitionSchema),
  subagents: z.array(repoDefinitionSchema),
  hooks: z.array(repoHookSchema),
  hooksFingerprint: z.string().nullable(),
  mcpServers: z.array(repoMcpServerSchema),
  ignored: z.array(ignoredSettingSchema),
  warnings: z.array(z.string()),
});
export type RepoAgentConfig = z.infer<typeof repoAgentConfigSchema>;

export const updateAgentConfigRequestSchema = z
  .object({
    instructions: z.boolean().optional(),
    skills: z.boolean().optional(),
    commands: z.boolean().optional(),
    subagents: z.boolean().optional(),
    hooks: z.boolean().optional(),
    hooksFingerprint: z.string().max(128).optional(),
  })
  .refine((body) => body.hooks !== true || body.hooksFingerprint !== undefined, {
    message: 'Turning hooks on needs the fingerprint of the hooks you reviewed.',
  });
export type UpdateAgentConfigRequest = z.infer<typeof updateAgentConfigRequestSchema>;

export const updateMcpServerRequestSchema = z
  .object({
    enabled: z.boolean(),
    fingerprint: z.string().max(128).optional(),
  })
  .refine((body) => !body.enabled || body.fingerprint !== undefined, {
    message: 'Turning a server on needs the fingerprint of the config you reviewed.',
  });
export type UpdateMcpServerRequest = z.infer<typeof updateMcpServerRequestSchema>;
