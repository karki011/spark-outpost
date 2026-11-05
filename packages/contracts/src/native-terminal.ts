import { z } from 'zod';
import { terminalColorsSchema } from './terminal-colors.ts';
import { createShellResponseSchema } from './terminal-shell.ts';

export const sessionTypeSchema = z.enum(['chat', 'terminal']);
export type SessionType = z.infer<typeof sessionTypeSchema>;

export const trackedTerminalProviderSchema = z.enum(['claude', 'codex']);
export type TrackedTerminalProvider = z.infer<typeof trackedTerminalProviderSchema>;

export const untrackedTerminalProviderSchema = z.enum(['gemini', 'opencode', 'amp']);

export const nativeTerminalProviderSchema = z.enum([
  ...trackedTerminalProviderSchema.options,
  ...untrackedTerminalProviderSchema.options,
]);
export type NativeTerminalProvider = z.infer<typeof nativeTerminalProviderSchema>;

const TERMINAL_PROVIDER_NAMES: Record<NativeTerminalProvider, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI',
  opencode: 'OpenCode',
  amp: 'Amp',
};

export function terminalProviderName(provider: NativeTerminalProvider): string {
  return TERMINAL_PROVIDER_NAMES[provider];
}

export function isTrackedTerminalProvider(
  provider: NativeTerminalProvider,
): provider is TrackedTerminalProvider {
  return trackedTerminalProviderSchema.safeParse(provider).success;
}

export function untrackedTerminalRefusal(provider: NativeTerminalProvider): string {
  return `Spark doesn’t follow ${terminalProviderName(provider)} sessions. Use it on your Mac.`;
}

export const terminalAgentSchema = z.object({
  id: nativeTerminalProviderSchema,
  name: z.string(),
  installed: z.boolean(),
});
export type TerminalAgent = z.infer<typeof terminalAgentSchema>;

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
