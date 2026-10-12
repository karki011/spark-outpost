import type { AgentCli } from './agent-cli.ts';

const FORK_SUBAGENTS = 'CLAUDE_CODE_FORK_SUBAGENT';
const NO_BACKGROUND_TASKS = 'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS';

export function withBackgroundSubagents(
  definition: { cli: AgentCli },
  env: Record<string, string>,
): Record<string, string> {
  if (definition.cli !== 'claude') return env;
  const kept = Object.fromEntries(
    Object.entries(env).filter(([name]) => name !== NO_BACKGROUND_TASKS),
  );
  return { ...kept, [FORK_SUBAGENTS]: '1' };
}
