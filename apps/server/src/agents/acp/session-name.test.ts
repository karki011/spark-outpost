import type * as acp from '@agentclientprotocol/sdk/unstable';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SESSION_NAME, nameNewSession, sessionName } from './session-name.ts';

const initWith = (title: object | null | undefined): acp.InitializeResponse => ({
  protocolVersion: 1,
  agentCapabilities: { sessionCapabilities: title === undefined ? {} : { title } },
});

function recorder(fail = false) {
  const calls: { method: string; params: unknown }[] = [];
  return {
    calls,
    ctx: {
      request: async (method: string, params: unknown) => {
        calls.push({ method, params });
        if (fail) throw new Error('rename failed');
        return {};
      },
    } as unknown as Pick<acp.ClientContext, 'request'>,
  };
}

describe('naming a new agent session', () => {
  it("sets the chat's title when the agent lets clients set titles", async () => {
    const { calls, ctx } = recorder();
    await nameNewSession(ctx, initWith({}), 's1', 'Fix the date divider');
    expect(calls).toEqual([
      { method: 'session/set_title', params: { sessionId: 's1', title: 'Fix the date divider' } },
    ]);
  });

  it('sends nothing to an agent that does not advertise titles', async () => {
    const { calls, ctx } = recorder();
    await nameNewSession(ctx, initWith(undefined), 's1', 'A title');
    await nameNewSession(ctx, initWith(null), 's1', 'A title');
    expect(calls).toEqual([]);
  });

  it('keeps the turn going when the agent refuses the name', async () => {
    const { calls, ctx } = recorder(true);
    await expect(nameNewSession(ctx, initWith({}), 's1', 'A title')).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('falls back to a fixed name and bounds a long one', () => {
    expect(sessionName(undefined)).toBe(DEFAULT_SESSION_NAME);
    expect(sessionName('   ')).toBe(DEFAULT_SESSION_NAME);
    expect(sessionName('x'.repeat(500))).toHaveLength(200);
  });
});
