import { join } from 'node:path';
import type { AgentLaunch } from '../src/agents/acp/agents.ts';
import type { ProviderOutput } from '../src/providers/provider.ts';

export const FAKE_ACP_LAUNCH: AgentLaunch = {
  command: process.execPath,
  args: ['--import', import.meta.resolve('tsx'), join(import.meta.dirname, 'fake-acp-agent.ts')],
};

export function replyText(outputs: readonly ProviderOutput[]): string {
  return outputs.map((output) => (output.kind === 'text_delta' ? output.delta : '')).join('');
}
