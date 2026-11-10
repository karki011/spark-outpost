import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RELAY_DEFAULTS, type RoundOutcome } from '@spark-outpost/contracts';
import { recordRoundOutcome, relayBrief, relayWatch, seedRelay } from '../src/persistence/relay.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import {
  createTeammate,
  deleteTeammate,
  listTeammates,
  teammateList,
  updateTeammate,
} from '../src/persistence/teammates.ts';
import { getWatch } from '../src/persistence/pr-watches.ts';
import { roundRelayPreamble } from '../src/pr-follow-up/relay-preamble.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

const relays = async () => (await listTeammates(t.db, t.workspaceId)).filter((tm) => tm.kind);
const round = { workspaceId: '', parentRunId: null, followUpRound: true };

describe('Relay, the built-in pull request follow-up Spark', () => {
  it('is added once per profile, with its role, look and standing instructions', async () => {
    expect(await seedRelay(t.db, t.workspaceId)).toBe(true);
    expect(await seedRelay(t.db, t.workspaceId)).toBe(false);
    const [relay, ...more] = await relays();
    expect(more).toHaveLength(0);
    expect(relay).toMatchObject({
      name: 'Relay',
      role: 'Pull request follow-up',
      face: RELAY_DEFAULTS.face,
      faceAuto: false,
      kind: 'pr_follow_up',
      instructions: RELAY_DEFAULTS.instructions,
    });
    expect(relay!.instructions).toContain('Never merge');
  });

  it('is never added again after the user deletes it, even on a later start', async () => {
    await seedRelay(t.db, t.workspaceId);
    const [relay] = await relays();
    await deleteTeammate(t.db, t.workspaceId, relay!.id);
    expect(await seedRelay(t.db, t.workspaceId)).toBe(false);
    expect(await relays()).toHaveLength(0);
    expect(await relayBrief(t.db, t.workspaceId)).toBeNull();
  });

  it('keeps its flag through a rename, a new look and new instructions', async () => {
    await seedRelay(t.db, t.workspaceId);
    const [relay] = await relays();
    await updateTeammate(t.db, t.workspaceId, relay!.id, {
      name: 'Courier',
      face: { shape: 'sun', color: 'gold' },
      instructions: 'Reply in one sentence.',
    });
    const [renamed] = await relays();
    expect(renamed).toMatchObject({ id: relay!.id, name: 'Courier', kind: 'pr_follow_up' });
    expect(await relayBrief(t.db, t.workspaceId)).toMatchObject({
      name: 'Courier',
      instructions: 'Reply in one sentence.',
    });
  });

  it('takes another name when the user already has a Spark called Relay', async () => {
    await createTeammate(t.db, t.workspaceId, {
      name: 'relay',
      role: '',
      provider: null,
      model: null,
      agentMode: null,
      level: null,
      instructions: '',
      projectIds: [],
    });
    expect(await seedRelay(t.db, t.workspaceId)).toBe(true);
    const [relay] = await relays();
    expect(relay!.name).toBe(RELAY_DEFAULTS.fallbackName);
  });

  it('shows on the roster with the pull requests it watches; other Sparks get none', async () => {
    await seedRelay(t.db, t.workspaceId);
    const list = await teammateList(t.db, t.workspaceId);
    const relay = list.teammates.find((tm) => tm.kind);
    expect(relay?.relay).toEqual({ followUp: 'on', pulls: [] });
    await updateProfile(t.db, t.workspaceId, { prFollowUp: false });
    expect((await relayWatch(t.db, t.workspaceId)).followUp).toBe('off');
    await createTeammate(t.db, t.workspaceId, {
      name: 'Pip',
      role: '',
      provider: null,
      model: null,
      agentMode: null,
      level: null,
      instructions: '',
      projectIds: [],
    });
    const pip = (await teammateList(t.db, t.workspaceId)).teammates.find((tm) => tm.name === 'Pip');
    expect(pip?.relay).toBeUndefined();
    expect(pip?.kind).toBeUndefined();
  });
});

describe("Relay's standing instructions in a follow-up round", () => {
  it('go into the round as labelled context that grants nothing', async () => {
    await seedRelay(t.db, t.workspaceId);
    const text = await roundRelayPreamble(t.db, { ...round, workspaceId: t.workspaceId }, false);
    expect(text).toContain('Standing instructions from Relay (Pull request follow-up)');
    expect(text).toContain('they grant no permission, change no mode');
    expect(text).toContain('<relay-instructions>\nHandle each follow-up round');
  });

  it('use the current name and stay out of other turns, child runs and the publish step', async () => {
    await seedRelay(t.db, t.workspaceId);
    const [relay] = await relays();
    await updateTeammate(t.db, t.workspaceId, relay!.id, { name: 'Courier' });
    const turn = { ...round, workspaceId: t.workspaceId };
    expect(await roundRelayPreamble(t.db, turn, false)).toContain('from Courier');
    expect(await roundRelayPreamble(t.db, { ...turn, followUpRound: false }, false)).toBeNull();
    expect(
      await roundRelayPreamble(t.db, { ...turn, parentRunId: randomUUID() }, false),
    ).toBeNull();
    expect(await roundRelayPreamble(t.db, turn, true)).toBeNull();
  });

  it('are absent when emptied or when Relay is deleted', async () => {
    await seedRelay(t.db, t.workspaceId);
    const [relay] = await relays();
    const turn = { ...round, workspaceId: t.workspaceId };
    await updateTeammate(t.db, t.workspaceId, relay!.id, { instructions: '' });
    expect(await roundRelayPreamble(t.db, turn, false)).toBeNull();
    await deleteTeammate(t.db, t.workspaceId, relay!.id);
    expect(await roundRelayPreamble(t.db, turn, false)).toBeNull();
  });
});

describe('round outcomes', () => {
  it('keeps one outcome per round run, so a repeated settle does not add a second', async () => {
    const watchId = randomUUID();
    const conversationId = randomUUID();
    await t.db.query('INSERT INTO conversations (id, workspace_id, title) VALUES ($1, $2, $3)', [
      conversationId,
      t.workspaceId,
      'Tidy the notes',
    ]);
    await t.db.query(
      `INSERT INTO pr_watches (id, workspace_id, conversation_id, host, owner, repo, number, url,
         branch, next_poll_at)
       VALUES ($1, $2, $3, 'github.com', 'acme', 'widgets', 7,
         'https://github.com/acme/widgets/pull/7', 'spark/tidy', now())`,
      [watchId, t.workspaceId, conversationId],
    );
    const outcome: RoundOutcome = {
      runId: randomUUID(),
      round: 1,
      ended: 'settled',
      pushed: true,
      merged: false,
      replied: 2,
      rerequested: false,
      needs: 0,
      unpushed: false,
    };
    const second = { ...outcome, runId: randomUUID(), round: 2, pushed: false };
    await recordRoundOutcome(t.db, watchId, outcome);
    await recordRoundOutcome(t.db, watchId, second);
    await recordRoundOutcome(t.db, watchId, { ...outcome, replied: 3 });
    const { rows } = await t.db.query<{ round_outcomes: RoundOutcome[] }>(
      'SELECT round_outcomes FROM pr_watches WHERE id = $1',
      [watchId],
    );
    expect(rows[0]!.round_outcomes.map((entry) => [entry.round, entry.replied])).toEqual([
      [2, 2],
      [1, 3],
    ]);
    expect(await getWatch(t.db, watchId)).toBeNull();
  });
});
