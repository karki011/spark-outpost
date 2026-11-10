import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queryable } from '../persistence/db.ts';
import { storyTaskOf } from '../persistence/outpost-stories.ts';
import { chatPromptFacts, chatTurnNoteFor, requestAssignedWork } from './chat-turn-prompt.ts';
import type { RunInput } from './run-input.ts';

vi.mock('../outposts/outpost-availability.ts', () => ({
  outpostNeeds: async () => ({ outpost: true, outpost_draft: true, outpost_start: true }),
}));
vi.mock('../persistence/setup.ts', () => ({ sparkPreferences: async () => ({}) }));
vi.mock('../persistence/outpost-stories.ts', () => ({ storyTaskOf: vi.fn() }));

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
    vi.mocked(storyTaskOf).mockResolvedValue(null);
  });

  it('treats an ordinary chat as a lead without requiring an Outpost', async () => {
    const facts = await chatPromptFacts(db, input);
    expect(facts.assignedWork).toBe(false);
    expect(facts.project).toBeNull();
  });

  it('keeps a story worker bounded across direct follow-up messages', async () => {
    vi.mocked(storyTaskOf).mockResolvedValue({
      task: {
        conversationId: 'chat',
        outpostId: 'outpost',
        draftId: null,
        leadConversationId: 'lead',
        title: 'Build the form',
        position: 0,
        dependsOnConversationId: null,
        openingPostId: null,
        createdAt: '2026-10-24T00:00:00.000Z',
      },
      handle: 'builder',
      storyTitle: null,
      leadHandle: 'lead',
      projectId: null,
      repoRoot: null,
      branch: null,
      baseBranch: null,
      ownsBranch: false,
      pull: null,
      opening: null,
    });
    expect((await chatPromptFacts(db, input)).assignedWork).toBe(true);
    expect(storyTaskOf).toHaveBeenCalledWith(db, 'chat');
  });

  it.each([
    [false, false, true],
    [true, false, false],
    [false, true, false],
    [true, true, false],
  ])('classifies fromUser=%s wrapUp=%s as assigned=%s', (fromUser, wrapUp, assigned) => {
    expect(
      requestAssignedWork({
        outpostRequest: { postId: 'post', outpostName: 'Work', fromUser, wrapUp },
      }),
    ).toBe(assigned);
  });

  it('keeps the session facts the same for an assigned request and a user turn', async () => {
    const user = await chatPromptFacts(db, input);
    const assigned = await chatPromptFacts(db, {
      ...input,
      followUpRound: true,
      outpostRequest: { postId: 'post', outpostName: 'Work', fromUser: false, wrapUp: false },
    });
    expect(assigned).toEqual(user);
  });

  it('keeps the start tool in the session facts for a request turn', async () => {
    const facts = await chatPromptFacts(db, {
      ...input,
      outpostRequest: { postId: 'post', outpostName: 'Work', fromUser: false, wrapUp: false },
    });
    expect(facts.outpostStartTool).toBe(true);
  });

  it('notes the assigned request and the follow-up round in the turn, not for a story worker twice', async () => {
    const request = {
      ...input,
      outpostRequest: { postId: 'post', outpostName: 'Work', fromUser: false, wrapUp: false },
    } as RunInput;
    const facts = await chatPromptFacts(db, request);
    expect(chatTurnNoteFor(request, facts)).toContain('assigned work');
    expect(chatTurnNoteFor(input, facts)).toBeNull();
    expect(chatTurnNoteFor(request, { ...facts, assignedWork: true })).toBeNull();
  });
});
