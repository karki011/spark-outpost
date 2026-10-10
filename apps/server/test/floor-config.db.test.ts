import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { GIT_CONTROL_REASON } from '../src/approvals/decide.ts';
import { CONFIG_READS, CONFIG_WRITE, CONFIG_WRITES_ELSEWHERE } from './fake-acp-floor.ts';
import { allowFloorCards, floorCard, floorRuns } from './floor-support.ts';

const { root, run, userCards, gateRecords, ranWithoutReview, railAudits } = floorRuns();

const MANUAL = 'default';
const BUILD_EDIT = 'Write notes.txt';
const MANUAL_BEFORE_THE_ASK_RULE = {
  readCards: [BUILD_EDIT],
  writeCards: [BUILD_EDIT, CONFIG_WRITE].sort(),
};

function localEmail(): string {
  try {
    return execFileSync('git', ['-C', root(), 'config', '--local', '--get', 'user.email'])
      .toString()
      .trim();
  } catch {
    return '';
  }
}

const holdCard = expect.objectContaining({
  kind: 'execute',
  reason: GIT_CONTROL_REASON,
  payload: expect.objectContaining({ command: CONFIG_WRITE, gitControl: ['.git/config'] }),
});

describe.each(['auto', 'bypassPermissions', 'acceptEdits'])(
  'git config in %s, where the agent runs commands without asking',
  { timeout: 120_000 },
  (mode) => {
    it('asks with hold-to-confirm before a command that sets git config runs', async () => {
      const { asked, detail, usedModes } = await run(mode, '#floorconfigwrite');
      expect(usedModes).toEqual([mode]);
      expect(asked.filter(floorCard)).toEqual([holdCard]);
      expect(localEmail()).toBe('');
      expect((detail.railFlags ?? []).map((flag) => flag.rail)).toEqual([]);
    });

    it('raises no card and no flag for a command that only reads git config', async () => {
      const { conversationId, detail, status } = await run(mode, '#floorconfigread');
      expect(status).toBe('succeeded');
      expect(await userCards(conversationId)).toEqual([]);
      expect(detail.railFlags ?? []).toEqual([]);
      expect(await gateRecords(conversationId)).toEqual(
        CONFIG_READS.map((title) => ({ title, status: 'allowed', decidedBy: 'level' })),
      );
    });

    it('flags afterwards the git config forms the ask rule cannot see', async () => {
      const { conversationId, detail, status } = await run(mode, '#floorconfigdir');
      expect(status).toBe('succeeded');
      expect(await userCards(conversationId)).toEqual([]);
      expect(await gateRecords(conversationId)).toEqual([]);
      expect(await ranWithoutReview(conversationId)).toEqual(
        expect.arrayContaining(CONFIG_WRITES_ELSEWHERE),
      );
      const flags = (detail.railFlags ?? []).map((flag) => [flag.rail, flag.paths, flag.status]);
      expect(flags.length).toBeGreaterThan(0);
      for (const flag of flags) expect(flag).toEqual(['git_control', ['.git/config'], 'open']);
      expect(new Set(await railAudits(conversationId))).toEqual(new Set(['git_control']));
    });
  },
);

describe('git config in Auto once the card is held and allowed', { timeout: 120_000 }, () => {
  it('runs the command and raises no flag for the change the user allowed', async () => {
    const { asked, detail, status } = await run('auto', '#floorconfigwrite', allowFloorCards);
    expect(status).toBe('succeeded');
    expect(asked.filter(floorCard)).toEqual([holdCard]);
    expect(localEmail()).toBe('floor@example.test');
    expect(detail.railFlags ?? []).toEqual([]);
  });
});

describe('git config in Manual, unchanged by the ask rule', { timeout: 120_000 }, () => {
  it('raises no card for the read forms, as before', async () => {
    const { conversationId, detail, usedModes } = await run(MANUAL, '#floorconfigread');
    expect(usedModes).toEqual([MANUAL]);
    expect(await userCards(conversationId)).toEqual(MANUAL_BEFORE_THE_ASK_RULE.readCards);
    expect(detail.railFlags ?? []).toEqual([]);
  });

  it('asks with hold-to-confirm for a write, as before', async () => {
    const { conversationId, asked } = await run(MANUAL, '#floorconfigwrite');
    expect(asked.filter(floorCard)).toEqual([holdCard]);
    expect((await userCards(conversationId)).sort()).toEqual(MANUAL_BEFORE_THE_ASK_RULE.writeCards);
    expect(localEmail()).toBe('');
  });

  it('sends the read forms to the gate, which allows them as reads', async () => {
    const { conversationId } = await run(MANUAL, '#floorconfigread');
    expect(await gateRecords(conversationId)).toEqual(
      CONFIG_READS.map((title) => ({ title, status: 'allowed', decidedBy: 'level' })),
    );
  });
});
