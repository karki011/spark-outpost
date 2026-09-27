import { z } from 'zod';

export const AGENT_COMMAND_NAME_MAX = 64;
export const AGENT_COMMAND_TEXT_MAX = 300;

export const agentCommandSchema = z.object({
  name: z.string().min(1).max(AGENT_COMMAND_NAME_MAX),
  description: z.string().max(AGENT_COMMAND_TEXT_MAX),
  hint: z.string().max(AGENT_COMMAND_TEXT_MAX).nullable(),
});
export type AgentCommand = z.infer<typeof agentCommandSchema>;

export const agentCommandsResponseSchema = z.object({
  provider: z.string().nullable(),
  commands: z.array(agentCommandSchema),
});
export type AgentCommandsResponse = z.infer<typeof agentCommandsResponseSchema>;

const HARNESS_OWNS_MODE = 'Spark Outpost sets the mode, model and permissions';
const HARNESS_OWNS_SESSION = 'Spark Outpost manages the agent session';
const HARNESS_OWNS_SETUP = 'it changes the agent setup outside Spark Outpost';
const HARNESS_OWNS_SIGN_IN = 'sign-in is managed in Settings';

export const BLOCKED_AGENT_COMMANDS: Readonly<Record<string, string>> = {
  'add-dir': HARNESS_OWNS_MODE,
  'allowed-tools': HARNESS_OWNS_MODE,
  approvals: HARNESS_OWNS_MODE,
  config: HARNESS_OWNS_MODE,
  effort: HARNESS_OWNS_MODE,
  fast: HARNESS_OWNS_MODE,
  mode: HARNESS_OWNS_MODE,
  model: HARNESS_OWNS_MODE,
  permissions: HARNESS_OWNS_MODE,
  plan: HARNESS_OWNS_MODE,
  sandbox: HARNESS_OWNS_MODE,
  settings: HARNESS_OWNS_MODE,
  clear: HARNESS_OWNS_SESSION,
  exit: HARNESS_OWNS_SESSION,
  fork: HARNESS_OWNS_SESSION,
  goal: HARNESS_OWNS_SESSION,
  new: HARNESS_OWNS_SESSION,
  quit: HARNESS_OWNS_SESSION,
  reset: HARNESS_OWNS_SESSION,
  resume: HARNESS_OWNS_SESSION,
  rewind: HARNESS_OWNS_SESSION,
  agents: HARNESS_OWNS_SETUP,
  hooks: HARNESS_OWNS_SETUP,
  ide: HARNESS_OWNS_SETUP,
  'install-github-app': HARNESS_OWNS_SETUP,
  mcp: HARNESS_OWNS_SETUP,
  memory: HARNESS_OWNS_SETUP,
  'output-style': HARNESS_OWNS_SETUP,
  plugin: HARNESS_OWNS_SETUP,
  plugins: HARNESS_OWNS_SETUP,
  'privacy-settings': HARNESS_OWNS_SETUP,
  statusline: HARNESS_OWNS_SETUP,
  'terminal-setup': HARNESS_OWNS_SETUP,
  vim: HARNESS_OWNS_SETUP,
  login: HARNESS_OWNS_SIGN_IN,
  logout: HARNESS_OWNS_SIGN_IN,
  upgrade: HARNESS_OWNS_SIGN_IN,
};

export function commandKey(name: string): string {
  return name.trim().replace(/^\//, '').toLowerCase();
}

export function blockedReason(name: string): string | null {
  const key = commandKey(name);
  return BLOCKED_AGENT_COMMANDS[key.split(':').at(-1) ?? key] ?? null;
}
