import { projectSecretValues } from '../audit/secret-values.ts';
import { folderExists, spawnInLoginShell } from '../preview/process.ts';
import type { PreviewRuntime } from '../preview/servers.ts';
import { killProcessTree } from './process-group.ts';

export interface AgentTerminalRuntime extends Pick<
  PreviewRuntime,
  'spawn' | 'folderExists' | 'env'
> {
  secretValues(roots: readonly string[]): Promise<readonly string[]>;
}

const KILL_AFTER_MS = 1_500;

function stopWithTerm(pid: number): void {
  killProcessTree(pid, KILL_AFTER_MS, 'SIGTERM');
}

export function agentTerminalRuntime(
  env: NodeJS.ProcessEnv = process.env,
  shell = env.SHELL || '/bin/zsh',
): AgentTerminalRuntime {
  return {
    env,
    folderExists,
    spawn: spawnInLoginShell(shell, stopWithTerm),
    secretValues: projectSecretValues,
  };
}
