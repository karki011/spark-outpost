import type * as acp from '@agentclientprotocol/sdk';

type Update = (value: acp.SessionUpdate) => Promise<void>;
type Say = (chunk: string) => Promise<void>;

export const WINDOW_TRIGGER = /#window:(\w+)/;
export const WINDOW_HOLD_TRIGGER = '#windowhold';
export const ADAPTER_DEFAULT_WINDOW = 200_000;
export const OPUS = 'claude-opus-5-5';

const opus = { '_claude/model': OPUS };

function request(used: number): acp.SessionUpdate {
  return { sessionUpdate: 'usage_update', used, size: ADAPTER_DEFAULT_WINDOW, _meta: opus };
}

function result(used: number, size: number): acp.SessionUpdate {
  return {
    sessionUpdate: 'usage_update',
    used,
    size,
    cost: { amount: 0.5, currency: 'USD' },
    _meta: opus,
  };
}

const SCRIPTS: Record<string, acp.SessionUpdate[]> = {
  long: [request(120_000), request(134_000), result(134_000, 1_000_000)],
  short: [request(150_000), result(150_000, 200_000)],
  midturn: [request(140_000)],
};

export async function windowTurn(
  text: string,
  update: Update,
  say: Say,
  signal: AbortSignal,
): Promise<acp.StopReason | null> {
  const script = SCRIPTS[WINDOW_TRIGGER.exec(text)?.[1] ?? ''];
  if (!script) return null;
  for (const step of script) await update(step);
  if (!text.includes(WINDOW_HOLD_TRIGGER)) {
    await say('ok');
    return 'end_turn';
  }
  await say('working');
  await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
  return 'cancelled';
}
