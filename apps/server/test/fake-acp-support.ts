import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as acp from '@agentclientprotocol/sdk/unstable';
import type { AgentLaunch } from '../src/agents/acp/agents.ts';
import type { ProviderOutput } from '../src/providers/provider.ts';
import { readFakeSession } from './fake-acp-sessions.ts';

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

const configStore =
  process.env.FAKE_ACP_STICKY_CONFIG === '1' ? process.env.FAKE_ACP_SESSION_STORE : null;
const configFile = (sessionId: string) => join(configStore ?? '', `${sessionId}.config.json`);

export function restoreConfig(sessionId: string, config: Record<string, string>): void {
  readFakeSession(sessionId);
  if (process.env.FAKE_ACP_RESUME_FAILS === '1')
    throw new Error('The session could not be reopened.');
  if (!configStore || !existsSync(configFile(sessionId))) return;
  Object.assign(config, JSON.parse(readFileSync(configFile(sessionId), 'utf8')));
}

export function rememberConfig(
  sessionId: string,
  config: Record<string, string>,
  configId: string,
  value: string,
): void {
  config[configId] = value;
  if (configStore) writeFileSync(configFile(sessionId), JSON.stringify(config));
}
