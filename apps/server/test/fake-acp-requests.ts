import { readFileSync } from 'node:fs';
import type * as acp from '@agentclientprotocol/sdk';

type Say = (chunk: string) => Promise<void>;

export const REQUESTS_TRIGGER = '#requests';
const SDK_MESSAGE_METHOD = '_claude/sdkMessage';

function askedForRequests(meta: unknown): boolean {
  const claudeCode = (meta as { claudeCode?: { emitRawSDKMessages?: unknown } } | null)?.claudeCode;
  return Array.isArray(claudeCode?.emitRawSDKMessages);
}

export async function requestsTurn(
  text: string,
  client: acp.AgentContext,
  meta: unknown,
  say: Say,
): Promise<acp.StopReason | null> {
  if (!text.includes(REQUESTS_TRIGGER)) return null;
  const file = process.env.FAKE_ACP_SDK_MESSAGES;
  if (file && askedForRequests(meta)) {
    const recorded = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>[];
    for (const params of recorded) await client.notify(SDK_MESSAGE_METHOD, params);
  }
  await say('ok');
  return 'end_turn';
}
