import { z } from 'zod';
import { mcpTransportSchema } from './agent-config.ts';
import { MCP_ENV_NAME_PATTERN, MCP_HEADER_NAME_PATTERN, MCP_NAME_PATTERN } from './mcp.ts';

export const MCP_VALUE_NAMES_MAX = 64;

export const mcpSwitchPlaceSchema = z.enum(['all_chats', 'this_chat', 'project']);
export type McpSwitchPlace = z.infer<typeof mcpSwitchPlaceSchema>;

export const mcpSwitchStateSchema = z.enum(['on', 'off', 'inherit']);
export type McpSwitchState = z.infer<typeof mcpSwitchStateSchema>;

const serverShape = {
  name: z.string().regex(MCP_NAME_PATTERN),
  transport: mcpTransportSchema,
  command: z.string().max(1024).nullable(),
  args: z.array(z.string().max(4096)).max(64),
  url: z.string().max(2048).nullable(),
  envNames: z.array(z.string().regex(MCP_ENV_NAME_PATTERN)).max(MCP_VALUE_NAMES_MAX),
  headerNames: z.array(z.string().regex(MCP_HEADER_NAME_PATTERN)).max(MCP_VALUE_NAMES_MAX),
  needsValues: z.array(z.string()).max(MCP_VALUE_NAMES_MAX * 2),
};

const projectRefSchema = z.object({ id: z.uuid(), name: z.string() });

export const addMcpServerActionSchema = z.object({
  action: z.literal('add_mcp_server'),
  ...serverShape,
  turnOn: z.enum(['all_chats', 'this_chat', 'off']),
});

export const updateMcpServerActionSchema = z.object({
  action: z.literal('update_mcp_server'),
  serverId: z.uuid(),
  ...serverShape,
  changed: z.array(z.string()).max(20),
  keepsOn: z.boolean(),
});

export const switchMcpServerActionSchema = z.object({
  action: z.literal('switch_mcp_server'),
  serverId: z.uuid(),
  ...serverShape,
  fingerprint: z.string(),
  place: mcpSwitchPlaceSchema,
  project: projectRefSchema.nullable(),
  state: mcpSwitchStateSchema,
});

export const removeMcpServerActionSchema = z.object({
  action: z.literal('remove_mcp_server'),
  serverId: z.uuid(),
  ...serverShape,
});

export type McpServerAction =
  | z.infer<typeof addMcpServerActionSchema>
  | z.infer<typeof updateMcpServerActionSchema>
  | z.infer<typeof switchMcpServerActionSchema>
  | z.infer<typeof removeMcpServerActionSchema>;

export const MCP_SWITCH_PLACE_LABELS: Record<McpSwitchPlace, string> = {
  all_chats: 'All chats',
  this_chat: 'This chat',
  project: 'One project',
};

export const MCP_NEW_SESSIONS_NOTE =
  'It takes effect in new agent sessions. Sessions already running keep the tools they started with.';
