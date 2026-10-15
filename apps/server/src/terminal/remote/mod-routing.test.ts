import { describe, expect, it } from 'vitest';
import type { Db } from '../../persistence/db.ts';
import type { LiveSession } from '../native-runtime-types.ts';
import { terminalApprovals } from './approvals.ts';
import { modInbox } from './mod-inbox.ts';
import { withMod } from './mod-routing.ts';
import { nativeRemote } from './native-remote.ts';

const MENU = '   Rewind\n   ❯ (current)\n   Enter to continue · Esc to cancel';
const PASTED = ['\u001b[200~hello\u001b[201~', '\r'];

function setup(options: { state?: string; screen?: string; modTakes?: boolean } = {}) {
  const row = {
    id: 's1',
    conversation_id: 'c1',
    provider: 'claude',
    state: options.state ?? 'ready',
    usage_file: null,
  };
  const db = {
    query: async (sql: string) => ({
      rows: sql.includes('remote_access_settings')
        ? [{ hostname: 'mac.example.ts.net', can_terminal: true, can_terminal_approve: true }]
        : sql.includes('pr_watches')
          ? []
          : [row],
    }),
  } as unknown as Db;
  const session = { row, transcript: null } as unknown as LiveSession;
  const sent: string[] = [];
  const approvals = terminalApprovals();
  const taken: string[][] = [];
  const mod = modInbox({
    db,
    workspaceId: 'w',
    delay: async () => {
      if (options.modTakes === false) return;
      taken.push((await mod.poll(session))!.messages);
      await new Promise<void>(() => undefined);
    },
  });
  const remote = withMod(
    nativeRemote({
      db,
      workspaceId: 'w',
      live: new Map([['c1', session]]),
      terminals: {
        send: (_id, data) => {
          sent.push(data);
          return true;
        },
        screen: async () => options.screen ?? '❯ ',
      },
      approvals,
      owned: async () => undefined,
      delay: async () => undefined,
    }),
    mod,
    approvals,
    db,
  );
  return { remote, mod, session, sent, taken, approvals };
}

describe('phone messages through the Claude mod', () => {
  it('goes through the mod once it has checked in, and types nothing', async () => {
    const { remote, mod, session, sent, taken } = setup();
    await mod.poll(session);
    await remote.message('c1', 'hello');
    expect(taken).toEqual([['hello']]);
    expect(sent).toEqual([]);
  });

  it('sends while a CLI menu shows, since the mod submits once Claude is idle', async () => {
    const { remote, mod, session, sent, taken } = setup({ screen: MENU });
    await mod.poll(session);
    await remote.message('c1', 'hello');
    expect(taken).toEqual([['hello']]);
    expect(sent).toEqual([]);
  });

  it('keeps refusing CLI commands, open approvals and open questions', async () => {
    for (const state of ['waiting_for_permission', 'waiting_for_input']) {
      const { remote, mod, session, sent, taken } = setup({ state });
      await mod.poll(session);
      await expect(remote.message('c1', 'hello')).rejects.toMatchObject({ status: 409 });
      expect([taken, sent]).toEqual([[], []]);
    }
    const { remote, mod, session, sent, taken, approvals } = setup();
    await mod.poll(session);
    await expect(remote.message('c1', '/model')).rejects.toMatchObject({ status: 409 });
    approvals.note({ conversationId: 'c1', provider: 'claude', tool: 'Bash', detail: 'ls' });
    await expect(remote.message('c1', 'hello')).rejects.toMatchObject({ status: 409 });
    expect([taken, sent]).toEqual([[], []]);
  });

  it('pastes as before when the mod never checked in', async () => {
    const { remote, sent, taken } = setup();
    await remote.message('c1', 'hello');
    expect(taken).toEqual([]);
    expect(sent).toEqual(PASTED);
  });

  it('falls back to pasting when the mod stops taking messages', async () => {
    const { remote, mod, session, sent } = setup({ modTakes: false });
    await mod.poll(session);
    await remote.message('c1', 'hello');
    expect(sent).toEqual(PASTED);
    expect((await mod.poll(session))!.messages).toEqual([]);
  });

  it('tells the terminal how the phone answered an approval', async () => {
    const { remote, mod, session } = setup();
    await mod.poll(session);
    const waiting = remote.permission(session, { tool: 'Bash' }, new AbortController().signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const { approval } = await remote.view('c1');
    await remote.decide('c1', { id: approval!.id, decision: 'deny' });
    await waiting;
    expect((await mod.poll(session))!.notices).toEqual(['Denied from your phone']);
  });

  it('marks the phone as following when a paired device reads the session', async () => {
    const { remote, mod, session } = setup();
    await remote.view('c1');
    expect((await mod.poll(session))!.status).toBeNull();
    await remote.view('c1', true);
    expect((await mod.poll(session))!.status).toBe('Spark · phone connected · approvals on');
  });
});
