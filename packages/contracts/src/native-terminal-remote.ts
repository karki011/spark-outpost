import { z } from 'zod';
import { nativeTerminalProviderSchema, nativeTerminalStateSchema } from './native-terminal.ts';

export const TERMINAL_MESSAGE_MAX_LENGTH = 16_000;
export const TERMINAL_DENY_REASON_MAX_LENGTH = 500;

export const terminalTranscriptItemSchema = z.object({
  id: z.string(),
  kind: z.enum(['user', 'assistant', 'tool', 'interrupt']),
  text: z.string(),
  tool: z.string().nullable(),
  at: z.string().nullable(),
  clipped: z.boolean(),
});
export type TerminalTranscriptItem = z.infer<typeof terminalTranscriptItemSchema>;

export const terminalApprovalSchema = z.object({
  id: z.uuid(),
  tool: z.string(),
  detail: z.string(),
  denyStopsTurn: z.boolean(),
});
export type TerminalApproval = z.infer<typeof terminalApprovalSchema>;

export const terminalRemoteViewSchema = z.object({
  provider: nativeTerminalProviderSchema,
  state: nativeTerminalStateSchema,
  running: z.boolean(),
  workingSince: z.string().nullable(),
  items: z.array(terminalTranscriptItemSchema),
  truncated: z.boolean(),
  approval: terminalApprovalSchema.nullable(),
});
export type TerminalRemoteView = z.infer<typeof terminalRemoteViewSchema>;

export const terminalMessageRequestSchema = z.strictObject({
  text: z.string().trim().min(1).max(TERMINAL_MESSAGE_MAX_LENGTH),
  now: z.boolean().optional(),
});
export type TerminalMessageRequest = z.infer<typeof terminalMessageRequestSchema>;

export const terminalApprovalDecisionSchema = z.strictObject({
  id: z.uuid(),
  decision: z.enum(['allow', 'deny']),
  reason: z.string().trim().max(TERMINAL_DENY_REASON_MAX_LENGTH).optional(),
});
export type TerminalApprovalDecision = z.infer<typeof terminalApprovalDecisionSchema>;
