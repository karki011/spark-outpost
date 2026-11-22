import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InvolvementLevel } from '@spark-outpost/contracts';
import { publishBasis } from '../src/approvals/publish-policy.ts';
import { insertChildRun } from '../src/persistence/orchestrations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { replyText } from '../src/persistence/spark-mentions.ts';
import { createTeammate } from '../src/persistence/teammates.ts';
import {
  actionFacts,
  explicitlyAsked,
  userWroteTurn,
} from '../src/spark-mcp/actions/action-policy.ts';
import { rulesSession } from '../src/spark-mcp/actions/rules-edit-session.ts';
import { publishGrant, publishScope } from '../src/workflow/publish-context.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import { gitRepo, openChat, removeRepo, sendMessage } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

let t: TestDb;
let root: string;
let harness: Worker | null = null;

const ASKS_TO_PUBLISH = '@Pip update ticket ENG-1, push it and open a pull request';

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await connectAgents(t);
  await createTeammate(t.db, t.workspaceId, {
    name: 'Pip',
    role: 'Code reviewer',
    provider: null,
    model: null,
    effort: null,
    agentMode: null,
    level: 'full-auto',
    instructions: '',
    projectIds: [],
  });
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

interface ChildRow {
  id: string;
  level: string | null;
  origin: string | null;
  work: boolean;
}

async function handOff(level: InvolvementLevel, agentMode: string, source = 'ui') {
  const conversationId = await openChat(t, { root, level });
  const runId = await sendMessage(t, conversationId, ASKS_TO_PUBLISH, {
    permission: 'do',
    agentMode,
    level,
  });
  await t.db.query('UPDATE runs SET source = $2 WHERE id = $1', [runId, source]);
  harness = startTurnWorker(t);
  await eventually(async () => ((await getRun(t.db, runId))?.finishedAt ? true : null), 60_000);
  await harness.stop();
  harness = null;
  const { rows } = await t.db.query<ChildRow>(
    `SELECT id, level, route->'spark'->>'origin' AS origin,
            COALESCE((route->'spark') ? 'work', false) AS work
     FROM runs WHERE parent_run_id = $1 ORDER BY created_at`,
    [runId],
  );
  expect(rows).toHaveLength(1);
  return { runId, child: rows[0]! };
}

const PLACES: readonly (readonly [InvolvementLevel, string])[] = [
  ['hands-off', 'default'],
  ['hands-off', 'acceptEdits'],
  ['hands-off', 'bypassPermissions'],
  ['full-auto', 'default'],
  ['full-auto', 'acceptEdits'],
  ['full-auto', 'bypassPermissions'],
];

describe('a Spark handed a message that asks to push and open a pull request', () => {
  it.each(PLACES)(
    'gets no basis to publish and is not the user’s message at %s in %s',
    async (level, agentMode) => {
      const { runId, child } = await handOff(level, agentMode);

      expect(await replyText(t.db, child.id)).toContain('open a pull request');
      expect(child.level).toBe('hands-off');
      expect(child.work).toBe(false);
      const input = await loadRunInput(t.db, child.id);
      const grant = publishGrant(input);
      expect(grant).toMatchObject({ level: 'hands-off', requested: false, followUp: null });
      expect(publishBasis('asks', grant)).toBeNull();
      expect(publishBasis('edits', grant)).toBeNull();
      expect(await publishScope(t.db, input)).toBeNull();

      expect(explicitlyAsked('jira_edit', ASKS_TO_PUBLISH)).toBe(true);
      expect(await userWroteTurn(t.db, runId)).toBe(true);
      expect(await userWroteTurn(t.db, child.id)).toBe(false);
      expect((await actionFacts(t.db, child.id, 'jira_edit')).requested).toBe(false);
      expect((await rulesSession(t.db, child.id))?.fromUser).toBe(false);
    },
    90_000,
  );

  it('keeps the parent turn the user’s own message', async () => {
    const { runId } = await handOff('hands-off', 'acceptEdits');

    expect(publishGrant(await loadRunInput(t.db, runId))).toMatchObject({ requested: true });
    expect((await actionFacts(t.db, runId, 'jira_edit')).requested).toBe(true);
    expect((await rulesSession(t.db, runId))?.fromUser).toBe(true);
  }, 90_000);
});

describe('where a mention came from', () => {
  it('records a message typed on the Mac', async () => {
    const { child } = await handOff('hands-off', 'default');

    expect(child.origin).toBe('typed_mac');
  }, 90_000);

  it.each(['ticket', 'voice'])(
    'records a %s turn as not typed, and still hands it off',
    async (source) => {
      const { child } = await handOff('hands-off', 'default', source);

      expect(child.origin).toBe('other');
    },
    90_000,
  );
});

describe('a child run marked as a working Spark', () => {
  async function marked(mode: 'ask' | 'chat', role: 'spark' | 'builder') {
    const conversationId = await openChat(t, { root, level: 'full-auto' });
    const parent = await sendMessage(t, conversationId, ASKS_TO_PUBLISH, {
      permission: 'do',
      agentMode: 'bypassPermissions',
      level: 'full-auto',
    });
    const lease = await insertChildRun(
      t.db,
      {
        parentRunId: parent,
        role,
        stepIndex: 0,
        attempt: 1,
        agentLabel: 'Pip · Code reviewer',
        provider: 'claude',
        model: null,
        effort: null,
        mode,
        level: 'hands-off',
        prompt: 'Fix it.',
        agentMode: 'bypassPermissions',
        route: {
          name: 'Pip',
          spark: { id: parent, role: 'Code reviewer', only: true, work: true },
        },
      },
      30,
    );
    return loadRunInput(t.db, lease.runId);
  }

  it('is read as a work run that is never the user’s message and cannot publish', async () => {
    const input = await marked('ask', 'spark');

    expect(input).toMatchObject({ sparkWork: true, assistantSent: true, level: 'hands-off' });
    expect(publishGrant(input)).toMatchObject({ requested: false, followUp: null });
    expect(await publishScope(t.db, input)).toBeNull();
  });

  it('ignores the mark on a run that is not a Spark’s project job', async () => {
    expect((await marked('chat', 'spark')).sparkWork).toBe(false);
    expect((await marked('ask', 'builder')).sparkWork).toBe(false);
  });
});
