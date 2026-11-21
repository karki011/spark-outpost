import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queryable } from '../persistence/db.ts';
import { chatPromptFacts, chatTurnNoteFor, requestAssignedWork } from './chat-turn-prompt.ts';
import type { RunInput } from './run-input.ts';

const readPreferences = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('../persistence/setup.ts', () => ({ sparkPreferences: readPreferences }));
vi.mock('../crew-flows/builder-chat.ts', () => ({ builderChatScope: async () => null }));
const splits = vi.hoisted(() => vi.fn(async () => false));
vi.mock('../sub-chats/availability.ts', () => ({ splitsIntoSubChats: splits }));

const db = {} as Queryable;
const input = {
  identity: { threadId: 'chat', runId: 'run' },
  workspaceId: 'workspace',
  projectRoots: [],
  level: 'hands-off',
  mode: 'do',
} as unknown as RunInput;

describe('chat delegation context', () => {
  beforeEach(() => {
    readPreferences.mockClear();
  });

  it('reads the preferences itself only when it was not given them', async () => {
    await chatPromptFacts(db, input);
    expect(readPreferences).toHaveBeenCalledTimes(1);
    const given = { agentInstructions: 'Prefer pnpm.' } as never;
    const facts = await chatPromptFacts(db, input, given);
    expect(readPreferences).toHaveBeenCalledTimes(1);
    expect(facts.customInstructions).toBe('Prefer pnpm.');
  });

  it('keeps the session facts the same for a turn another chat started and a user turn', async () => {
    const user = await chatPromptFacts(db, input);
    const ask = { id: 'ask', kind: 'task', fromTitle: 'Checkout rework', wantsReply: true };
    const assigned = await chatPromptFacts(db, { ...input, chatAsk: ask } as RunInput);
    expect(assigned).toEqual(user);
    expect(user.project).toBeNull();
  });

  it('gives the split guidance only to a chat that is offered spark_sub_chats', async () => {
    expect((await chatPromptFacts(db, input)).subChatsTool).toBe(false);
    splits.mockResolvedValueOnce(true);
    expect((await chatPromptFacts(db, input)).subChatsTool).toBe(true);
    expect(splits).toHaveBeenCalledWith(db, 'chat');
  });

  it('notes a sub-chat’s task turn as assigned work, and no other message from a chat', async () => {
    const ask = { id: 'ask', fromTitle: 'Checkout rework', wantsReply: true };
    const task = { ...input, chatAsk: { ...ask, kind: 'task' } } as RunInput;
    const message = { ...input, chatAsk: { ...ask, kind: 'message' } } as RunInput;
    const facts = await chatPromptFacts(db, task);
    expect(requestAssignedWork(task)).toBe(true);
    expect(chatTurnNoteFor(task, facts)).toContain('do not use spark_sub_chats');
    expect(requestAssignedWork(message)).toBe(false);
    expect(chatTurnNoteFor(message, facts)).toBeNull();
  });
});
