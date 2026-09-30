import { describe, expect, it } from 'vitest';
import type * as acp from '@agentclientprotocol/sdk';
import { attachSteering, STEER_METHOD, steeringSupported } from './steering.ts';

function init(meta: unknown): acp.InitializeResponse {
  return { protocolVersion: 1, _meta: meta } as acp.InitializeResponse;
}

describe('ACP steering', () => {
  it('only steers adapters that advertise it', () => {
    expect(steeringSupported(init({ steering: { supported: true } }))).toBe(true);
    expect(steeringSupported(init({ claudeCode: { promptQueueing: true } }))).toBe(false);
    expect(steeringSupported(init(undefined))).toBe(false);
  });

  it('sends the note into the running turn and reports whether it was injected', async () => {
    const calls: unknown[] = [];
    const ctx = {
      request: (method: string, params: unknown) => {
        calls.push([method, params]);
        return Promise.resolve({ outcome: 'injected' });
      },
    } as unknown as Pick<acp.ClientContext, 'request'>;
    let send: ((text: string) => Promise<boolean>) | null = null;
    const steering = {
      attach: (sender: (text: string) => Promise<boolean>) => {
        send = sender;
        return () => undefined;
      },
    };
    attachSteering(ctx, init({ steering: { supported: true } }), 's1', steering);
    expect(await send!('Use UTC')).toBe(true);
    expect(calls).toEqual([
      [
        STEER_METHOD,
        {
          sessionId: 's1',
          prompt: [{ type: 'text', text: 'Use UTC' }],
          _meta: { steering: { idleBehavior: 'promptRequired' } },
        },
      ],
    ]);
    send = null;
    attachSteering(ctx, init(undefined), 's1', steering);
    expect(send).toBeNull();
  });
});
