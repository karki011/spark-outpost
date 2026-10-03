import { z } from 'zod';
import {
  fingerprintSchema,
  mcpScopeSchema,
  mcpServerSourceSchema,
  mcpTransportSchema,
  SERVER_FINGERPRINT_MESSAGE,
} from './agent-config.ts';

export const MCP_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const MCP_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
export const MCP_HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/;
const variableName = z.string().regex(MCP_ENV_NAME_PATTERN);
const headerName = z.string().regex(MCP_HEADER_NAME_PATTERN);

export const mcpCheckSchema = z.object({
  ok: z.boolean(),
  tools: z.array(z.string()),
  error: z.string().nullable(),
  checkedAt: z.string(),
  fingerprint: z.string(),
});
export type McpCheck = z.infer<typeof mcpCheckSchema>;

export const mcpEnablementSchema = z.object({
  enabled: z.boolean(),
  changed: z.boolean(),
});
export type McpEnablement = z.infer<typeof mcpEnablementSchema>;

export const userMcpServerSchema = z.object({
  id: z.uuid(),
  source: mcpServerSourceSchema,
  name: z.string(),
  transport: mcpTransportSchema,
  command: z.string().nullable(),
  args: z.array(z.string()),
  url: z.string().nullable(),
  envNames: z.array(z.string()),
  headerNames: z.array(z.string()),
  secretNames: z.array(z.string()),
  fingerprint: z.string(),
  global: mcpEnablementSchema.nullable(),
  projects: z.array(mcpEnablementSchema.extend({ projectId: z.uuid() })),
  check: mcpCheckSchema.nullable(),
});
export type UserMcpServer = z.infer<typeof userMcpServerSchema>;

export const userMcpListSchema = z.object({
  servers: z.array(userMcpServerSchema),
});
export type UserMcpList = z.infer<typeof userMcpListSchema>;

const secretMap = <T extends z.ZodType<string>>(key: T) =>
  z.record(key, z.string().max(8192)).refine((map) => Object.keys(map).length <= 64, {
    message: 'Up to 64 values per server.',
  });

export const saveUserMcpRequestSchema = z
  .object({
    name: z.string().regex(MCP_NAME_PATTERN, 'Use letters, numbers, - and _ (up to 64).'),
    transport: mcpTransportSchema,
    command: z.string().trim().max(1024).nullable(),
    args: z.array(z.string().max(4096)).max(64),
    url: z
      .url({ protocol: /^https?$/ })
      .max(2048)
      .nullable(),
    env: secretMap(variableName),
    headers: secretMap(headerName),
  })
  .refine((body) => (body.transport === 'stdio' ? !!body.command : !!body.url), {
    message: 'A stdio server needs a command; HTTP and SSE servers need a URL.',
  });
export type SaveUserMcpRequest = z.infer<typeof saveUserMcpRequestSchema>;

export const mcpEnableRequestSchema = z
  .object({
    scope: mcpScopeSchema,
    scopeId: z.uuid().optional(),
    enabled: z.boolean().nullable(),
    fingerprint: fingerprintSchema.optional(),
  })
  .refine((body) => body.scope === 'global' || body.scopeId !== undefined, {
    message: 'Project and chat switches need the project or chat.',
  })
  .refine((body) => body.enabled !== true || body.fingerprint !== undefined, {
    message: SERVER_FINGERPRINT_MESSAGE,
  });
export type McpEnableRequest = z.infer<typeof mcpEnableRequestSchema>;

export const chatMcpViaSchema = z.enum(['chat', 'project', 'global', 'off']);
export type ChatMcpVia = z.infer<typeof chatMcpViaSchema>;

export const chatMcpServerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('user'),
    id: z.uuid(),
    name: z.string(),
    source: mcpServerSourceSchema,
    transport: mcpTransportSchema,
    fingerprint: z.string(),
    enabled: z.boolean(),
    via: chatMcpViaSchema,
    changed: z.boolean(),
    check: mcpCheckSchema.nullable(),
  }),
  z.object({
    kind: z.literal('project'),
    projectId: z.uuid(),
    projectName: z.string(),
    name: z.string(),
    transport: mcpTransportSchema,
    enabled: z.boolean(),
    changed: z.boolean(),
  }),
]);
export type ChatMcpServer = z.infer<typeof chatMcpServerSchema>;

export const chatMcpListSchema = z.object({ servers: z.array(chatMcpServerSchema) });
export type ChatMcpList = z.infer<typeof chatMcpListSchema>;
