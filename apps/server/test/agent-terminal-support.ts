import type { AgentTerminalRuntime } from '../src/terminal/agent-terminal-process.ts';
import type { AgentTerminalTimings } from '../src/terminal/agent-terminals.ts';
import { fakePreviewRuntime, type FakePreviewRuntime } from './preview-support.ts';

export interface FakeAgentTerminalRuntime extends Omit<FakePreviewRuntime, 'runtime'> {
  runtime: AgentTerminalRuntime;
  secrets: string[];
}

export function fakeAgentTerminalRuntime(
  env: NodeJS.ProcessEnv = { PATH: '/usr/bin' },
): FakeAgentTerminalRuntime {
  const preview = fakePreviewRuntime(env);
  const secrets: string[] = [];
  return Object.assign(preview, {
    secrets,
    runtime: { ...preview.runtime, secretValues: async () => secrets },
  });
}

export const FAST_AGENT_TERMINALS: AgentTerminalTimings = { saveMs: 10, watchEveryMs: 25 };
