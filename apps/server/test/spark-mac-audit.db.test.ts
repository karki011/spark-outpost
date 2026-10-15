import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MacHostError } from '../src/mac-control/host-client.ts';
import { ALLOWED_ON_CARD } from '../src/spark-mcp/tools/allowed-note.ts';
import { MacHarness } from './spark-mac-support.ts';

let h: MacHarness;

beforeEach(async () => {
  h = await MacHarness.create();
});

afterEach(async () => {
  await h.close();
});

const press = (ref: string) => ({ action: 'press', app: 'Calculator', ref });

describe('a Mac control call that fails before acting', () => {
  it('audits a menu item that is not found, with the reason and no app content', async () => {
    await h.start({ mode: 'auto' });
    await h.allowFirstUse();
    h.fake.targetError = new MacHostError('not_found', 'no menu item "Secret Plans"');
    const failed = await h.call('spark_mac_act', {
      action: 'menu',
      app: 'Calculator',
      menu: ['View', 'Secret Plans'],
    });
    expect(failed.result.isError).toBe(true);
    expect(h.audited().at(-1)).toEqual(
      expect.objectContaining({
        tool: 'spark_mac_act',
        action: 'menu',
        app: 'Calculator',
        decision: 'refused',
        reason: 'not_found',
      }),
    );
    expect(JSON.stringify(h.audited())).not.toContain('Secret Plans');
  });

  it('audits a ref the app no longer knows and a stale ref', async () => {
    await h.start({ mode: 'auto' });
    await h.allowFirstUse();
    h.fake.targetError = new MacHostError('gone', 'ax_3 is not known');
    expect((await h.call('spark_mac_act', press('ax_3'))).result.isError).toBe(true);
    h.fake.targetError = null;
    h.fake.targetState = 'gone';
    expect((await h.call('spark_mac_act', press('ax_3'))).result.isError).toBe(true);
    expect(
      h
        .audited()
        .slice(-2)
        .map((entry) => [entry.action, entry.reason]),
    ).toEqual([
      ['press', 'gone'],
      ['press', 'stale_ref'],
    ]);
  });

  it('audits an app that is not running, and a refused app exactly once', async () => {
    await h.start({ mode: 'auto' });
    h.fake.apps = h.fake.apps.map((app) => (app.name === 'Notes' ? { ...app, pid: null } : app));
    expect((await h.call('spark_mac_read', { app: 'Notes' })).result.isError).toBe(true);
    expect((await h.call('spark_mac_read', { app: 'System Settings' })).result.isError).toBe(true);
    expect(h.audited().map((entry) => [entry.app, entry.decision, entry.reason])).toEqual([
      ['Notes', 'refused', 'not_running'],
      ['System Settings', 'refused', 'system_settings'],
    ]);
  });

  it('audits a call refused because Mac control is off', async () => {
    await h.start({ mode: 'auto' });
    await h.t.db.query('UPDATE profiles SET mac_control = false WHERE workspace_id = $1', [
      h.t.workspaceId,
    ]);
    expect((await h.call('spark_mac_apps')).result.isError).toBe(true);
    expect(h.audited().at(-1)).toMatchObject({ tool: 'spark_mac_apps', reason: 'off' });
  });
});

describe('failures that are not refusals, and bad input', () => {
  it('audits a helper timeout and crash as failed, not refused', async () => {
    await h.start({ mode: 'auto' });
    await h.allowFirstUse();
    h.fake.readError = new MacHostError('timeout', 'Mac control took too long to answer.');
    expect((await h.call('spark_mac_read', { app: 'Calculator' })).result.isError).toBe(true);
    h.fake.targetError = new MacHostError('failed', 'The Mac control helper exited.');
    expect((await h.call('spark_mac_act', press('ax_3'))).result.isError).toBe(true);
    expect(
      h
        .audited()
        .slice(-2)
        .map((entry) => [entry.action, entry.decision, entry.reason]),
    ).toEqual([
      ['read', 'failed', 'timeout'],
      ['press', 'failed', 'failed'],
    ]);
  });

  it('audits malformed arguments with the tool name only', async () => {
    await h.start({ mode: 'auto' });
    const refused = await h.call('spark_mac_act', { action: 'fly-to-the-moon', app: 'Calculator' });
    expect(refused.result.isError).toBe(true);
    expect(h.audited()).toEqual([
      expect.objectContaining({
        tool: 'spark_mac_act',
        action: 'invalid_input',
        decision: 'refused',
        reason: 'invalid_input',
      }),
    ]);
    expect(JSON.stringify(h.audited())).not.toContain('fly-to-the-moon');
    expect(h.fake.ops()).toEqual([]);
  });
});

describe('a result after a card', () => {
  it('says the user allowed it when the call waited on a card, and not otherwise', async () => {
    await h.start({ mode: 'default' });
    const reading = h.call('spark_mac_read', { app: 'Calculator' });
    await h.answer('confirm');
    expect((await reading).facts.allowed).toBe(ALLOWED_ON_CARD);
    const pressing = h.call('spark_mac_act', press('ax_3'));
    await h.answer('confirm');
    expect((await pressing).facts.allowed).toBe(ALLOWED_ON_CARD);
    const again = await h.call('spark_mac_act', press('ax_3'));
    expect(again.facts.outcome).toBe('done');
    expect(again.facts.allowed).toBeUndefined();
  });

  it('says so for a send press in a mode that runs at once', async () => {
    await h.start({ mode: 'auto' });
    await h.allowFirstUse();
    const plain = await h.call('spark_mac_act', press('ax_3'));
    expect(plain.facts.allowed).toBeUndefined();
    const sending = h.call('spark_mac_act', press('ax_4'));
    await h.answer('confirm');
    expect((await sending).facts.allowed).toBe(ALLOWED_ON_CARD);
  });
});
