import { describe, expect, it } from 'vitest';
import type { Db } from '../../persistence/db.ts';
import type { LiveSession } from '../native-runtime-types.ts';
import { FOLLOWED_MS, MOD_FRESH_MS, modInbox, modStatus } from './mod-inbox.ts';

function session(provider: 'claude' | 'codex' = 'claude') {
  return { row: { conversation_id: 'c1', provider } } as unknown as LiveSession;
}

function setup(options: { approve?: boolean; timeout?: 'now' | 'never' } = {}) {
  let clock = 1_000_000;
  const db = {
    query: async (sql: string) => ({
      rows: sql.includes('remote_access_settings')
        ? [{ hostname: 'mac.example.ts.net', can_terminal_approve: options.approve ?? false }]
        : [],
    }),
  } as unknown as Db;
  const mod = modInbox({
    db,
    workspaceId: 'w',
    now: () => clock,
    delay: () =>
      options.timeout === 'never' ? new Promise<void>(() => undefined) : Promise.resolve(),
  });
  return { mod, advance: (ms: number) => (clock += ms) };
}

describe('the mod status line', () => {
  it('says what a glance needs and nothing when there is nothing to say', () => {
    expect(modStatus({ phone: false, approvals: true, pull: null })).toBeNull();
    expect(modStatus({ phone: true, approvals: false, pull: null })).toBe(
      'Spark · phone connected',
    );
    expect(modStatus({ phone: true, approvals: true, pull: null })).toBe(
      'Spark · phone connected · approvals on',
    );
    expect(
      modStatus({
        phone: true,
        approvals: true,
        pull: { number: 7, state: 'open', checks: 'failing' },
      }),
    ).toBe('Spark · phone connected · approvals on · PR #7 · checks failing');
    expect(
      modStatus({
        phone: false,
        approvals: false,
        pull: { number: 7, state: 'open', checks: 'none' },
      }),
    ).toBe('Spark · PR #7');
    expect(
      modStatus({
        phone: false,
        approvals: false,
        pull: { number: 7, state: 'merged', checks: 'passing' },
      }),
    ).toBe('Spark · PR #7 merged');
    expect(
      modStatus({
        phone: false,
        approvals: false,
        pull: { number: 7, state: 'closed', checks: 'passing' },
      }),
    ).toBeNull();
  });
});

describe('the mod inbox', () => {
  it('counts the mod as active only while it keeps checking in', async () => {
    const { mod, advance } = setup();
    expect(mod.active('c1')).toBe(false);
    await mod.poll(session());
    expect(mod.active('c1')).toBe(true);
    advance(MOD_FRESH_MS + 1);
    expect(mod.active('c1')).toBe(false);
  });

  it('serves Claude sessions only', async () => {
    const { mod } = setup();
    expect(await mod.poll(session('codex'))).toBeNull();
    expect(mod.active('c1')).toBe(false);
  });

  it('hands a message to the next poll once, and the sender learns it was taken', async () => {
    const { mod } = setup({ timeout: 'never' });
    await mod.poll(session());
    const sent = mod.send('c1', 'run the tests');
    await Promise.resolve();
    expect((await mod.poll(session()))?.messages).toEqual(['run the tests']);
    await expect(sent).resolves.toBe(true);
    expect((await mod.poll(session()))?.messages).toEqual([]);
  });

  it('withdraws a message the mod did not take in time', async () => {
    const { mod } = setup({ timeout: 'now' });
    await mod.poll(session());
    await expect(mod.send('c1', 'run the tests')).resolves.toBe(false);
    expect((await mod.poll(session()))?.messages).toEqual([]);
  });

  it('queues nothing when the mod has not checked in', async () => {
    const { mod } = setup({ timeout: 'never' });
    await expect(mod.send('c1', 'hello')).resolves.toBe(false);
  });

  it('passes an approval answer from the phone to the terminal once', async () => {
    const { mod } = setup();
    mod.decided('c1', 'allow');
    await mod.poll(session());
    expect((await mod.poll(session()))?.notices).toEqual([]);
    mod.decided('c1', 'deny');
    mod.decided('c1', 'allow');
    expect((await mod.poll(session()))?.notices).toEqual([
      'Denied from your phone',
      'Allowed from your phone',
    ]);
    expect((await mod.poll(session()))?.notices).toEqual([]);
  });

  it('shows the phone as connected while it follows the session', async () => {
    const { mod, advance } = setup({ approve: true });
    expect((await mod.poll(session()))?.status).toBeNull();
    mod.followed('c1');
    expect((await mod.poll(session()))?.status).toBe('Spark · phone connected · approvals on');
    advance(FOLLOWED_MS + 1);
    expect((await mod.poll(session()))?.status).toBeNull();
  });

  it('forgets a session that ended', async () => {
    const { mod } = setup();
    await mod.poll(session());
    mod.ended('c1');
    expect(mod.active('c1')).toBe(false);
  });
});
