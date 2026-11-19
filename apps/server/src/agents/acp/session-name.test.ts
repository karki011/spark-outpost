import type * as acp from '@agentclientprotocol/sdk/unstable';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SESSION_NAME, nameSession, sessionName } from './session-name.ts';

const initWith = (title: object | null | undefined): acp.InitializeResponse => ({
  protocolVersion: 1,
  agentCapabilities: { sessionCapabilities: title === undefined ? {} : { title } },
});

function recorder(answer: (title: string) => unknown = () => ({})) {
  const calls: { method: string; params: unknown }[] = [];
  return {
    calls,
    ctx: {
      request: async (method: string, params: { title: string }) => {
        calls.push({ method, params });
        return answer(params.title);
      },
    } as unknown as Pick<acp.ClientContext, 'request'>,
  };
}

const failing = () => {
  throw new Error('rename failed');
};

describe('naming an agent session', () => {
  it("sets the chat's title when the agent lets clients set titles", async () => {
    const { calls, ctx } = recorder((title) => ({ title }));
    const name = await nameSession(ctx, initWith({}), 's1', 'Fix the date divider', null);
    expect(calls).toEqual([
      { method: 'session/set_title', params: { sessionId: 's1', title: 'Fix the date divider' } },
    ]);
    expect(name).toEqual({ requested: 'Fix the date divider', stored: 'Fix the date divider' });
  });

  it('keeps the title the agent stored when it normalized the one sent', async () => {
    const { ctx } = recorder((title) => ({ title: title.slice(0, 8) }));
    const name = await nameSession(ctx, initWith({}), 's1', 'Fix the date divider', null);
    expect(name).toEqual({ requested: 'Fix the date divider', stored: 'Fix the ' });
  });

  it('falls back to the title sent when the agent answers without one', async () => {
    const { ctx } = recorder(() => ({}));
    expect(await nameSession(ctx, initWith({}), 's1', 'Notes', null)).toEqual({
      requested: 'Notes',
      stored: 'Notes',
    });
  });

  it('renames only when the chat title changed', async () => {
    const { calls, ctx } = recorder((title) => ({ title }));
    const known = { requested: 'Old name', stored: 'Old name' };
    expect(await nameSession(ctx, initWith({}), 's1', 'Old name', known)).toBe(known);
    expect(calls).toEqual([]);
    const renamed = await nameSession(ctx, initWith({}), 's1', 'New name', known);
    expect(renamed).toEqual({ requested: 'New name', stored: 'New name' });
    expect(calls).toHaveLength(1);
  });

  it('does not rename again when the agent stored a normalized form of the same title', async () => {
    const { calls, ctx } = recorder();
    const known = { requested: 'Fix the date divider', stored: 'Fix the ' };
    expect(await nameSession(ctx, initWith({}), 's1', 'Fix the date divider', known)).toBe(known);
    expect(calls).toEqual([]);
  });

  it('sends nothing to an agent that does not advertise titles', async () => {
    const { calls, ctx } = recorder();
    expect(await nameSession(ctx, initWith(undefined), 's1', 'A title', null)).toBeNull();
    await nameSession(ctx, initWith(null), 's1', 'A title', null);
    expect(calls).toEqual([]);
  });

  it('keeps the turn going and the known name when the agent refuses the name', async () => {
    const { calls, ctx } = recorder(failing);
    const known = { requested: 'Old', stored: 'Old' };
    await expect(nameSession(ctx, initWith({}), 's1', 'A title', known)).resolves.toBe(known);
    expect(calls).toHaveLength(1);
  });

  it('falls back to a fixed name and bounds a long one', () => {
    expect(sessionName(undefined)).toBe(DEFAULT_SESSION_NAME);
    expect(sessionName('   ')).toBe(DEFAULT_SESSION_NAME);
    expect(sessionName('x'.repeat(500))).toHaveLength(200);
  });
});
