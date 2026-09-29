import { join } from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';
import type { AgentLaunch } from '../src/agents/acp/agents.ts';
import type { ProviderOutput } from '../src/providers/provider.ts';

export const FAKE_ACP_LAUNCH: AgentLaunch = {
  command: process.execPath,
  args: [join(import.meta.dirname, 'fake-acp-agent.ts')],
};

export function replyText(outputs: readonly ProviderOutput[]): string {
  return outputs.map((output) => (output.kind === 'text_delta' ? output.delta : '')).join('');
}

export function describeBlock(block: acp.ContentBlock): string {
  if (block.type === 'image') return `image:${block.mimeType}:${block.data.length}`;
  if (block.type === 'resource') return `resource:${block.resource.uri}`;
  return block.type;
}
