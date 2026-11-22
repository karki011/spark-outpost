import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InvolvementLevel } from '@spark-outpost/contracts';
import { publishBasis } from '../src/approvals/publish-policy.ts';
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
    `SELECT id, level, route->'spark'->>'origin' AS origin
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
