import { describe, expect, it } from 'vitest';
import type { Db } from '../../persistence/db.ts';
import type { LiveSession } from '../native-runtime-types.ts';
import { terminalApprovals } from './approvals.ts';
import { modInbox } from './mod-inbox.ts';
import { answerWaits, withMod } from './mod-routing.ts';
import { nativeRemote } from './native-remote.ts';

const ESC = '\u001b';

function setup(options: { aborts?: boolean; takes?: boolean; settles?: boolean } = {}) {
  const row = {
    id: 's1',
    conversation_id: 'c1',
    provider: 'claude',
    state: 'working',
    native_turn_id: 'prompt-1',
    usage_file: null,
  };
  const db = {
    query: async (sql: string) => ({
      rows: sql.includes('remote_access_settings')
        ? [{ hostname: 'mac.example.ts.net', can_terminal: true, can_terminal_approve: false }]
        : sql.includes('pr_watches')
          ? []
          : [row],
    }),
  } as unknown as Db;
  const session = { row, transcript: null } as unknown as LiveSession;
  const sent: string[] = [];
  const handed: (string | null)[] = [];
  const approvals = terminalApprovals();
  const waitsForAnswer = answerWaits(approvals, db);
  const body = { abort: options.aborts ?? true };
  const mod = modInbox({
    db,
    workspaceId: 'w',
    waitsForAnswer,
    delay: async () => {
      if (options.takes === false) return;
      const reply = await mod.poll(session, body);
      handed.push(reply!.abort);
      if (reply!.abort && options.settles !== false) row.state = 'ready';
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
        screen: async () => '❯ ',
      },
      approvals,
      owned: async () => undefined,
      delay: async () => undefined,
    }),
    mod,
    { db, waitsForAnswer, delay: async () => undefined },
  );
  return { remote, mod, session, row, sent, handed, body };
}

describe('Stop from a paired device', () => {
  it('stops the turn through the mod and sends no Esc', async () => {
    const { remote, mod, session, body, sent, handed } = setup();
    await mod.poll(session, body);
    await remote.interrupt('c1');
    expect(handed).toEqual(['prompt-1']);
    expect(sent).toEqual([]);
  });

  it('sends Esc as before when the mod that checked in predates Stop', async () => {
    const { remote, mod, session, sent, handed } = setup({ aborts: false });
    await mod.poll(session, {});
    await remote.interrupt('c1');
    expect(handed).toEqual([]);
    expect(sent).toEqual([ESC]);
  });

  it('sends Esc as before when the mod never checked in', async () => {
    const { remote, sent } = setup();
    await remote.interrupt('c1');
    expect(sent).toEqual([ESC]);
  });

  it('falls back to Esc when the mod does not take the Stop', async () => {
    const { remote, mod, session, body, sent } = setup({ takes: false });
    await mod.poll(session, body);
    await remote.interrupt('c1');
    expect(sent).toEqual([ESC]);
    expect((await mod.poll(session, body))!.abort).toBeNull();
  });

  it('presses Esc once when the turn is still working after the mod took the Stop', async () => {
    const { remote, mod, session, body, sent } = setup({ settles: false });
    await mod.poll(session, body);
    await remote.interrupt('c1');
    expect(sent).toEqual([ESC]);
  });

  it('refuses with nothing sent when the agent is not working', async () => {
    const { remote, mod, session, body, row, sent, handed } = setup();
    row.state = 'ready';
    await mod.poll(session, body);
    await expect(remote.interrupt('c1')).rejects.toMatchObject({ status: 409 });
    expect([sent, handed]).toEqual([[], []]);
  });

  it('hands a Stop out once, so a later poll aborts nothing', async () => {
    const { remote, mod, session, body } = setup();
    await mod.poll(session, body);
    await remote.interrupt('c1');
    expect((await mod.poll(session, body))!.abort).toBeNull();
  });

  it('stops once and sends no Esc when Stop is pressed twice at once', async () => {
    const { remote, mod, session, body, sent, handed } = setup();
    await mod.poll(session, body);
    await Promise.all([remote.interrupt('c1'), remote.interrupt('c1')]);
    expect(handed.filter(Boolean)).toEqual(['prompt-1']);
    expect(sent).toEqual([]);
  });

  it('adds the permission line only while a paired device may answer approvals', async () => {
    const { mod, session, body } = setup();
    expect((await mod.poll(session, body))!.askNotice).toBeNull();
  });
});
