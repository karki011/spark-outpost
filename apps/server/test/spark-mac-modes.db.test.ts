import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MacHarness } from './spark-mac-support.ts';

let h: MacHarness;

beforeEach(async () => {
  h = await MacHarness.create();
});

afterEach(async () => {
  await h.close();
});

const MODES: [provider: string, mode: string, name: string, asks: boolean][] = [
  ['claude', 'auto', 'Auto', false],
  ['claude', 'bypassPermissions', 'Bypass permissions', false],
  ['claude', 'acceptEdits', 'Accept edits', true],
  ['claude', 'default', 'Manual', true],
  ['claude', 'plan', 'Plan', true],
  ['codex', 'agent', 'Auto review', false],
  ['codex', 'agent-full-access', 'Full access', false],
  ['codex', 'ask-every-action', 'Ask every time', true],
  ['codex', 'read-only', 'Read-only', true],
];

describe('pressing follows the mode the user picked, in a chat with no project', () => {
  for (const [provider, mode, name, asks] of MODES) {
    it(`${name} ${asks ? 'shows the press card' : 'presses at once'}`, async () => {
      await h.start({ mode, provider });
      await h.allowFirstUse();
      const pressing = h.call('spark_mac_act', { action: 'press', app: 'Calculator', ref: 'ax_3' });
      if (asks) {
        expect((await h.pending()).payload.sparkAction).toMatchObject({ action: 'mac_act' });
        await h.answer('confirm');
      }
      expect((await pressing).facts.outcome).toBe('done');
      expect(await h.cards()).toEqual(asks ? ['mac_use_app', 'mac_act'] : ['mac_use_app']);
      expect(h.audited().at(-1)).toMatchObject({ decision: asks ? 'user_allowed' : 'mode' });
    });
  }

  it('still asks for a send press in Auto review', async () => {
    await h.start({ mode: 'agent', provider: 'codex' });
    await h.allowFirstUse();
    const pressing = h.call('spark_mac_act', { action: 'press', app: 'Calculator', ref: 'ax_4' });
    expect((await h.pending()).payload.sparkAction).toMatchObject({ action: 'mac_press' });
    await h.answer('confirm');
    expect((await pressing).facts.outcome).toBe('done');
  });
});
