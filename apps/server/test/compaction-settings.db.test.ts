import { afterEach, describe, expect, it } from 'vitest';
import {
  CHECKPOINT_OPTION,
  COMPACT_GAP_ERROR,
  updateProfileRequestSchema,
  type UpdateProfileRequest,
} from '@spark-outpost/contracts';
import { decideApproval } from '../src/persistence/approvals.ts';
import { InvalidDefaultError, getSetupState, updateProfile } from '../src/persistence/setup.ts';
import {
  compactionsOf,
  finished,
  newChat,
  pendingCard,
  say,
  send,
  startCompactionHarness,
  type CompactionHarness,
} from './compaction-support.ts';

let h: CompactionHarness;

afterEach(async () => {
  await h.stop();
});

async function start(update: UpdateProfileRequest) {
  h = await startCompactionHarness(['compact']);
  await updateProfile(h.t.db, h.t.workspaceId, update);
}

async function cardPayload(runId: string) {
  const card = await pendingCard(h, runId);
  const { rows } = await h.t.db.query<{ payload: { checkpoint: Record<string, unknown> } }>(
    'SELECT payload FROM approvals WHERE id = $1',
    [card.id],
  );
  return { id: card.id, kind: card.kind, checkpoint: rows[0]!.payload.checkpoint };
}

async function answer(cardId: string, runId: string, optionId: string) {
  await decideApproval(h.t.db, h.t.workspaceId, cardId, { optionId, scope: 'once' });
  return finished(h, runId);
}

describe('custom compaction thresholds', { timeout: 60_000 }, () => {
  it('asks at the saved point with automatic compaction off, and again 10 points later', async () => {
    await start({
      compactWarnPercent: 40,
      compactAtPercent: 60,
      autoCompact: false,
      autoContinueSeconds: 10,
    });
    const id = await newChat(h, 'hands-off');
    await say(h, id, 'Start #ctx55');
    const quiet = await say(h, id, 'Go on #ctx62');
    expect(quiet.run.status).toBe('succeeded');

    const runId = await send(h, id, 'Next');
    const card = await cardPayload(runId);
    expect(card.kind).toBe('compact');
    expect(card.checkpoint).toMatchObject({ askAgainAt: 70 });
    expect(card.checkpoint.reason).toContain("The agent's context is 62% full");
    await answer(card.id, runId, CHECKPOINT_OPTION.keepGoing);

    const snoozed = await say(h, id, 'More #ctx75');
    expect(snoozed.run.status).toBe('succeeded');
    const again = await send(h, id, 'Again');
    expect((await cardPayload(again)).kind).toBe('compact');
  });

  it('compacts by itself at Automatic once the saved point is reached', async () => {
    await start({ compactWarnPercent: 30, compactAtPercent: 50 });
    const id = await newChat(h, 'hands-off');
    await say(h, id, 'Start #ctx45');
    const quiet = await say(h, id, 'Keep at it #ctx52');
    expect(quiet.steps.some((step) => step.includes('/compact'))).toBe(false);

    const next = await say(h, id, 'What next?');

    expect(next.steps).toContain('Sent /compact to the agent (104K tokens)');
    expect((await compactionsOf(h, id)).map((row) => row.method)).toEqual(['agent']);
  });

  it.each(['hands-off', 'full-auto'] as const)(
    'only offers the card at %s when automatic compaction is off',
    async (level) => {
      await start({ autoCompact: false });
      const id = await newChat(h, level);
      await say(h, id, 'Start #ctx90');

      const runId = await send(h, id, 'Next');
      const card = await cardPayload(runId);
      expect(card.kind).toBe('compact');
      expect(card.checkpoint.reason).toContain('Automatic compaction is off');
      const run = await answer(card.id, runId, CHECKPOINT_OPTION.keepGoing);

      expect(run.status).toBe('succeeded');
      expect(await compactionsOf(h, id)).toEqual([]);
    },
  );
});

describe('compaction threshold settings', { timeout: 60_000 }, () => {
  it('defaults to 60% and 80% with automatic compaction on', async () => {
    h = await startCompactionHarness(['compact']);
    const { profile } = await getSetupState(h.t.db, h.t.workspaceId);
    expect(profile).toMatchObject({
      compactWarnPercent: 60,
      compactAtPercent: 80,
      autoCompact: true,
    });
  });

  it('rejects a warning less than 5 points below the saved compaction point', async () => {
    await start({ compactWarnPercent: 50, compactAtPercent: 70 });
    await expect(
      updateProfile(h.t.db, h.t.workspaceId, { compactWarnPercent: 66 }),
    ).rejects.toThrow(new InvalidDefaultError(COMPACT_GAP_ERROR));
    await expect(updateProfile(h.t.db, h.t.workspaceId, { compactAtPercent: 54 })).rejects.toThrow(
      COMPACT_GAP_ERROR,
    );
    await updateProfile(h.t.db, h.t.workspaceId, { compactWarnPercent: 65 });
    const { profile } = await getSetupState(h.t.db, h.t.workspaceId);
    expect(profile).toMatchObject({ compactWarnPercent: 65, compactAtPercent: 70 });
  });

  it('rejects values outside the ranges at the API boundary and in the database', async () => {
    h = await startCompactionHarness(['compact']);
    const parse = (update: Record<string, unknown>) =>
      updateProfileRequestSchema.safeParse(update).success;
    expect(parse({ compactWarnPercent: 29 })).toBe(false);
    expect(parse({ compactWarnPercent: 91 })).toBe(false);
    expect(parse({ compactAtPercent: 39 })).toBe(false);
    expect(parse({ compactAtPercent: 96 })).toBe(false);
    expect(parse({ compactAtPercent: 82.5 })).toBe(false);
    expect(parse({ compactWarnPercent: 30, compactAtPercent: 95 })).toBe(true);
    await getSetupState(h.t.db, h.t.workspaceId);
    await expect(
      h.t.db.query('UPDATE profiles SET compact_warn_percent = 78 WHERE workspace_id = $1', [
        h.t.workspaceId,
      ]),
    ).rejects.toThrow(/profiles_compact_gap_check/);
  });
});
