import { readFileSync } from 'node:fs';
import * as acp from '@agentclientprotocol/sdk/unstable';

type Update = (value: acp.SessionUpdate) => Promise<void>;
type Say = (chunk: string) => Promise<void>;

export const RATE_LIMIT_TRIGGER = '#ratelimit';
export const USAGE_LIMIT_TRIGGER = '#usagelimit';

function recordedUpdate(): acp.SessionUpdate | null {
  const file = process.env.FAKE_ACP_RATE_LIMIT;
  if (!file) return null;
  const recorded = JSON.parse(readFileSync(file, 'utf8')) as { update: acp.SessionUpdate };
  return recorded.update;
}

export async function rateLimitTurn(
  text: string,
  update: Update,
  say: Say,
): Promise<acp.StopReason | null> {
  if (!text.includes(RATE_LIMIT_TRIGGER)) return null;
  const recorded = recordedUpdate();
  if (recorded) await update(recorded);
  if (text.includes(USAGE_LIMIT_TRIGGER)) {
    throw acp.RequestError.internalError(
      { errorKind: 'rate_limit' },
      "You've hit your usage limit",
    );
  }
  await say('ok');
  return 'end_turn';
}
