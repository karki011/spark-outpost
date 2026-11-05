import { z } from 'zod';
import { providerIdSchema } from './setup.ts';
import { terminalColorsSchema } from './terminal-colors.ts';

export const TERMINAL_INPUT_MAX_LENGTH = 16_384;

export const terminalStepSchema = z.enum(['install', 'login']);
export type TerminalStep = z.infer<typeof terminalStepSchema>;

export const createTerminalRequestSchema = z.object({
  provider: providerIdSchema,
  step: terminalStepSchema.default('install'),
});

export const createTerminalResponseSchema = z.object({
  id: z.uuid(),
  token: z.string(),
  command: z.string(),
});
export type CreateTerminalResponse = z.infer<typeof createTerminalResponseSchema>;

export const createShellRequestSchema = z.strictObject({
  conversationId: z.uuid().nullable().default(null),
});
export type CreateShellRequest = z.input<typeof createShellRequestSchema>;

export {
  shellFolderKindSchema,
  createShellResponseSchema,
  type ShellFolderKind,
  type CreateShellResponse,
} from './terminal-shell.ts';

export { terminalColorsSchema, type TerminalColors } from './terminal-colors.ts';

export const shellBusyResponseSchema = z.object({
  command: z.string().nullable(),
});
export type ShellBusyResponse = z.infer<typeof shellBusyResponseSchema>;

export const terminalEndReasonSchema = z.enum([
  'exited',
  'closed',
  'disconnected',
  'idle',
  'time_limit',
  'shutdown',
  'folder_removed',
  'chat_removed',
]);
export type TerminalEndReason = z.infer<typeof terminalEndReasonSchema>;

export const terminalHintSchema = z.object({
  id: z.string(),
  message: z.string(),
  checkAgain: z.boolean(),
});
export type TerminalHint = z.infer<typeof terminalHintSchema>;

export const terminalServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hint'), hint: terminalHintSchema }),
  z.object({
    type: z.literal('ended'),
    reason: terminalEndReasonSchema,
    exitCode: z.number().int().nullable(),
  }),
]);
export type TerminalServerMessage = z.infer<typeof terminalServerMessageSchema>;

export const terminalClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('resize'),
    cols: z.number().int().min(10).max(500),
    rows: z.number().int().min(4).max(200),
  }),
  z.object({ type: z.literal('close') }),
  z.object({ type: z.literal('colors'), colors: terminalColorsSchema }),
]);
export type TerminalClientMessage = z.infer<typeof terminalClientMessageSchema>;
