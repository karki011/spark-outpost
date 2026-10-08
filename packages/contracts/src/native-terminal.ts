import { z } from 'zod';
import { createShellResponseSchema } from './terminal-shell.ts';

export const sessionTypeSchema = z.enum(['chat', 'terminal']);
export type SessionType = z.infer<typeof sessionTypeSchema>;

export const nativeTerminalProviderSchema = z.enum(['claude', 'codex']);
export type NativeTerminalProvider = z.infer<typeof nativeTerminalProviderSchema>;

export const nativeTerminalStateSchema = z.enum([
  'starting',
  'working',
  'waiting_for_permission',
  'waiting_for_input',
  'ready',
  'exited',
  'error',
  'unknown',
  'interrupted',
]);
export type NativeTerminalState = z.infer<typeof nativeTerminalStateSchema>;

export const nativeTerminalSessionSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  provider: nativeTerminalProviderSchema,
  state: nativeTerminalStateSchema,
  cwd: z.string(),
  label: z.string(),
  updatedAt: z.string(),
  resumeAvailable: z.boolean(),
  runId: z.uuid().nullable(),
  observation: z.enum(['hooks', 'unsupported']),
  reason: z.string().nullable(),
});
export type NativeTerminalSession = z.infer<typeof nativeTerminalSessionSchema>;

export const nativeTerminalLaunchRequestSchema = z.strictObject({
  provider: nativeTerminalProviderSchema.optional(),
  prompt: z.string().trim().min(1).max(100_000).optional(),
  messageId: z.uuid().optional(),
  resume: z.boolean().default(false),
});
export type NativeTerminalLaunchRequest = z.infer<typeof nativeTerminalLaunchRequestSchema>;

export const nativeTerminalLaunchResponseSchema = z.object({
  session: nativeTerminalSessionSchema,
  connection: createShellResponseSchema,
});
export type NativeTerminalLaunchResponse = z.infer<typeof nativeTerminalLaunchResponseSchema>;
