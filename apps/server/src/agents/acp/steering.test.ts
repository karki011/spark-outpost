import { describe, expect, it } from 'vitest';
import type * as acp from '@agentclientprotocol/sdk/unstable';
import type { ProviderMessage } from '../../providers/provider.ts';
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
    let send: ((text: ProviderMessage) => Promise<boolean | 'later'>) | null = null;
    const steering = {
      attach: (sender: (text: ProviderMessage) => Promise<boolean>) => {
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
  it('includes screenshot bytes and file context when steering', async () => {
    const calls: unknown[] = [];
    const ctx = {
      request: (_method: string, params: unknown) => {
        calls.push(params);
        return Promise.resolve({ outcome: 'injected' });
      },
    } as unknown as Pick<acp.ClientContext, 'request'>;
    let send: ((message: ProviderMessage) => Promise<boolean | 'later'>) | null = null;
    const capabilities = init({ steering: { supported: true } });
    capabilities.agentCapabilities = { promptCapabilities: { image: true, embeddedContext: true } };
    attachSteering(ctx, capabilities, 's1', {
      attach(sender) {
        send = sender;
        return () => undefined;
      },
    });
    expect(
      await send!({
        text: 'Check this screenshot',
        attachments: [
          {
            name: 'screen.png',
            mediaType: 'image/png',
            kind: 'image',
            data: Buffer.from('pixels'),
          },
          {
            name: 'notes.txt',
            mediaType: 'text/plain',
            kind: 'text',
            data: Buffer.from('keep the server running'),
          },
        ],
      }),
    ).toBe(true);
    expect(calls).toEqual([
      expect.objectContaining({
        prompt: expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('Check this screenshot'),
          }),
          { type: 'image', data: Buffer.from('pixels').toString('base64'), mimeType: 'image/png' },
          {
            type: 'resource',
            resource: {
              uri: 'attachment:///notes.txt',
              mimeType: 'text/plain',
              text: 'keep the server running',
            },
          },
        ]),
      }),
    ]);
  });
});
