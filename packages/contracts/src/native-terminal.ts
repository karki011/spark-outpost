import { z } from 'zod';
import { terminalColorsSchema } from './terminal-colors.ts';
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

export const terminalDependenciesSchema = z.object({
  state: z.enum(['preparing', 'failed']),
  step: z.enum(['copy', 'install']).nullable(),
  note: z.string().nullable(),
});
export type TerminalDependencies = z.infer<typeof terminalDependenciesSchema>;

export function terminalDependenciesText(dependencies: TerminalDependencies): string {
  if (dependencies.state === 'failed')
    return dependencies.note ?? 'Dependencies could not be prepared in this session’s worktree.';
  const doing = dependencies.step === 'install' ? 'installing' : 'copying';
  return `Dependencies are still ${doing}. Commands that need them may fail until this finishes.`;
}

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
  agentMode: z.string().nullable().default(null),
  readopted: z.object({ at: z.string(), stepsComplete: z.boolean() }).nullable().optional(),
  dependencies: terminalDependenciesSchema.nullable().optional(),
});
export type NativeTerminalSession = z.infer<typeof nativeTerminalSessionSchema>;

export const nativeTerminalLaunchRequestSchema = z.strictObject({
  provider: nativeTerminalProviderSchema.optional(),
  prompt: z.string().trim().min(1).max(100_000).optional(),
  messageId: z.uuid().optional(),
  resume: z.boolean().default(false),
  colors: terminalColorsSchema.optional(),
});
export type NativeTerminalLaunchRequest = z.infer<typeof nativeTerminalLaunchRequestSchema>;

export const nativeTerminalLaunchResponseSchema = z.object({
  session: nativeTerminalSessionSchema,
  connection: createShellResponseSchema,
});
export type NativeTerminalLaunchResponse = z.infer<typeof nativeTerminalLaunchResponseSchema>;

export const terminalStartPhaseSchema = z.enum([
  'preparing',
  'fetch',
  'worktree',
  'copy',
  'install',
  'agent',
]);
export type TerminalStartPhase = z.infer<typeof terminalStartPhaseSchema>;

export const terminalStartSchema = z.object({ phase: terminalStartPhaseSchema.nullable() });
export type TerminalStart = z.infer<typeof terminalStartSchema>;

export function terminalStartText(phase: TerminalStartPhase | null, agentName: string): string {
  switch (phase) {
    case 'fetch':
      return 'Fetching the latest from the remote…';
    case 'worktree':
      return 'Creating this session’s worktree…';
    case 'copy':
      return 'Copying dependencies…';
    case 'install':
      return 'Installing dependencies…';
    case 'agent':
      return `Starting ${agentName}…`;
    default:
      return 'Starting terminal…';
  }
}
