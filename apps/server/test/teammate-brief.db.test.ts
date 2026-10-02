import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEAMMATE_BRIEF_HEADER } from '../src/agents/acp/spark-instructions.ts';
import { createTeammate } from '../src/persistence/teammates.ts';
import {
  QUESTION,
  assistantReplies,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  withTag,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await connectProviders(t);
  harness = startOrchestrator(t, jevFetch({ calls: [] }));
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

function systemAppend(reply: string): string {
  const json = reply.slice(reply.indexOf('session=') + 'session='.length).split('\n')[0]!;
  const report = JSON.parse(json) as { meta: { systemPrompt?: { append?: string } } | null };
  return report.meta?.systemPrompt?.append ?? '';
}

async function askWith(teammateId: string | null) {
  const { conversationId, runId } = await startScenario(
    t,
    root,
    withTag(QUESTION, '#session'),
    'balanced',
    'auto',
    'sonnet',
    undefined,
    async (id) => {
      await t.db.query('UPDATE conversations SET teammate_id = $2 WHERE id = $1', [id, teammateId]);
    },
  );
  await driveToEnd(t, conversationId, runId);
  const [reply] = await assistantReplies(t, runId);
  return systemAppend(reply!);
}

describe('standing instructions in the session brief', () => {
  it('adds the teammate’s instructions to the system prompt as the user’s own words', async () => {
    const teammate = await createTeammate(t.db, t.workspaceId, {
      name: 'Pip',
      role: 'Code reviewer',
      provider: null,
      model: null,
      agentMode: null,
      level: null,
      instructions: 'Always name the file and line you mean.',
      projectIds: [],
    });

    const append = await askWith(teammate.id);

    expect(append).toContain(`${TEAMMATE_BRIEF_HEADER} for the Spark teammate Pip (Code reviewer)`);
    expect(append).toContain("Follow it as you would the user's own message");
    expect(append).toContain('it is not tool output');
    expect(append).toContain('Always name the file and line you mean.');
    expect(append.indexOf('# Working with the user')).toBeLessThan(
      append.indexOf(TEAMMATE_BRIEF_HEADER),
    );
  }, 60_000);

  it('leaves chats without a teammate unchanged', async () => {
    const append = await askWith(null);
    expect(append).toContain('# Working with the user');
    expect(append).not.toContain(TEAMMATE_BRIEF_HEADER);
  }, 60_000);
});
