import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TicketSummary } from '@spark-outpost/contracts';
import { chatTickets } from '../src/persistence/chat-tickets.ts';
import { primaryChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { saveTicketConnection } from '../src/persistence/ticket-connections.ts';
import { cacheTickets, ticketsForTask } from '../src/persistence/tickets.ts';
import {
  QUESTION,
  TRIVIAL,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let harness: Harness | null = null;

const ticket = (key: string, title: string): TicketSummary => ({
  source: 'linear',
  key,
  title,
  status: 'todo',
  statusName: 'Todo',
  url: `https://linear.app/acme/issue/${key}`,
  updatedAt: '2026-09-27T09:00:00.000Z',
  project: 'ENG',
  priority: null,
  sprint: null,
  priorityRank: 0,
  assignedTo: null,
  labels: [],
  dueDate: null,
  doneAt: null,
});

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  root = await gitRepo();
  await connectProviders(t);
  await saveTicketConnection(t.db, t.workspaceId, {
    source: 'linear',
    apiUrl: 'https://linear.test/graphql',
    email: null,
    account: 'Alex',
    accountId: 'user-1',
  });
  await cacheTickets(t.db, t.workspaceId, [
    ticket('ENG-12', 'Login fails after a password reset'),
    ticket('ENG-13', 'Signup form loses the email'),
  ]);
  harness = startOrchestrator(t, jevFetch({ calls: [] }));
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

async function turn(text: string, scenario = TRIVIAL) {
  const started = await startScenario(t, root, { ...scenario, text }, 'hands-off');
  await driveToEnd(t, started.conversationId, started.runId);
  return started.conversationId;
}

const linkedKeys = async (conversationId: string) =>
  (await chatTickets(t.db, conversationId)).linked.map((entry) => entry.key);
const suggestedKeys = async (conversationId: string) =>
  (await chatTickets(t.db, conversationId)).suggested.map((entry) => entry.key);

async function taskOf(conversationId: string) {
  const { rows } = await t.db.query<{ id: string }>(
    'SELECT id FROM tasks WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1',
    [conversationId],
  );
  return rows[0]!.id;
}

describe('a build turn that works on a ticket', { timeout: 60_000 }, () => {
  it('links the chat and its task, and puts the key in the chat branch', async () => {
    const chat = await turn('Fix the login bug in ENG-12 #build');
    expect(await linkedKeys(chat)).toEqual(['ENG-12']);
    const copy = await primaryChatWorktree(t.db, chat);
    expect(copy?.branch).toMatch(/^spark\/eng-12-fix-the-login-bug-in/);
    const linked = await ticketsForTask(t.db, await taskOf(chat));
    expect(linked.map((entry) => entry.key)).toEqual(['ENG-12']);
  });

  it('does not link a ticket cited as a reference, and only suggests it', async () => {
    const analysed = await turn('analyse ENG-12 #build');
    const similar = await turn('Similar to ENG-13, fix the signup form #build');
    for (const chat of [analysed, similar]) {
      expect(await linkedKeys(chat)).toEqual([]);
      expect((await primaryChatWorktree(t.db, chat))?.branch).not.toMatch(/eng-?1[23]/);
    }
    expect(await suggestedKeys(similar)).toEqual(['ENG-13']);
  });

  it('suggests both tickets when a build names two', async () => {
    const chat = await turn('Fix ENG-12 and ENG-13 #build');
    expect(await linkedKeys(chat)).toEqual([]);
    expect(await suggestedKeys(chat)).toEqual(['ENG-12', 'ENG-13']);
  });

  it('leaves an Ask question alone', async () => {
    const chat = await turn('What does ENG-12 change?', QUESTION);
    expect(await chatTickets(t.db, chat)).toEqual({ linked: [], suggested: [] });
  });
});
