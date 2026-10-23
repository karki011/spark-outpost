import { describe, expect, it } from 'vitest';
import {
  isStacked,
  stackedCount,
  storyOrder,
  storyProblems,
  type StoryChat,
  type StoryOrderItem,
} from './outpost-story.ts';
import {
  createOutpostRequestSchema,
  outpostDetailSchema,
  outpostDraftSchema,
  outpostStorySchema,
  requestFactsSchema,
  stackWarningKindSchema,
  type OutpostStory,
} from './outposts.ts';
import { OUTPOST_DRAFT_ACTIVITY, outpostDraftActivitySchema, runSchema } from './runs.ts';
import { SPARK_TEXT_MAX } from './spark-actions.ts';

const OUTPOST = '0f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const LEAD = '1f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const API = '2f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const WEB = '3f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const PROJECT = '4f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const DRAFT = '5f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const POST = '6f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const AT = '2026-10-09T10:00:00.000Z';

const draft = {
  name: 'Orders launch',
  title: 'Checkout',
  chats: [
    { handle: 'api', title: 'Orders endpoint', projectId: PROJECT, task: 'Add the endpoint.' },
    {
      handle: 'web',
      title: 'Orders page',
      projectId: PROJECT,
      agent: 'codex',
      task: 'Build the page.',
      dependsOn: 'api',
    },
  ],
};

const story: OutpostStory = {
  draftId: DRAFT,
  title: 'Checkout',
  leadConversationId: LEAD,
  leadHandle: 'lead',
  tasks: [
    {
      conversationId: API,
      handle: 'api',
      title: 'Orders endpoint',
      position: 0,
      dependsOn: null,
      dependsOnHandle: null,
      stacked: false,
      openingPostId: POST,
      state: 'answered',
      reason: null,
      branch: 'spark/orders-endpoint-0a1b2c3d',
      pullRequest: {
        number: 123,
        url: 'https://github.com/acme/shop/pull/123',
        state: 'merged',
        draft: false,
        base: 'main',
      },
      warnings: [],
    },
    {
      conversationId: WEB,
      handle: 'web',
      title: 'Orders page',
      position: 1,
      dependsOn: API,
      dependsOnHandle: 'api',
      stacked: true,
      openingPostId: null,
      state: 'sent',
      reason: 'Waiting for @api',
      branch: null,
      pullRequest: null,
      warnings: [{ kind: 'base_merged', text: 'Merging this now would not reach main' }],
    },
  ],
};

describe('outpost draft', () => {
  it('reads back a draft of new chats with tasks and one dependency unchanged', () => {
    expect(outpostDraftSchema.parse(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
  });

  it('needs a title and at least one chat, and takes a draft with no outpost name', () => {
    const unnamed = { title: draft.title, chats: draft.chats };
    expect(outpostDraftSchema.parse(unnamed)).toEqual(unnamed);
    expect(outpostDraftSchema.safeParse({ ...draft, title: '  ' }).success).toBe(false);
    expect(outpostDraftSchema.safeParse({ ...draft, chats: [] }).success).toBe(false);
  });

  it('takes a proposed mode per chat, and none', () => {
    const [chat] = draft.chats;
    const proposed = { ...draft, chats: [{ ...chat, agentMode: 'acceptEdits' }] };
    expect(outpostDraftSchema.parse(proposed)).toEqual(proposed);
    expect(outpostDraftSchema.parse(draft).chats[0]).not.toHaveProperty('agentMode');
    expect(
      outpostDraftSchema.safeParse({ ...draft, chats: [{ ...chat, agentMode: '' }] }).success,
    ).toBe(false);
  });

  it('refuses a chat with no project, an unknown agent, an empty task or a malformed dependency', () => {
    const [chat] = draft.chats;
    for (const broken of [
      { ...chat, projectId: undefined },
      { ...chat, agent: 'nobody' },
      { ...chat, task: '  ' },
      { ...chat, task: 'x'.repeat(SPARK_TEXT_MAX + 1) },
      { ...chat, title: 'x'.repeat(101) },
      { ...chat, dependsOn: '@api' },
    ]) {
      expect(outpostDraftSchema.safeParse({ ...draft, chats: [broken] }).success).toBe(false);
    }
  });
});

describe('outpost story', () => {
  it('reads back a story with a stacked task, a pull request and a warning unchanged', () => {
    expect(outpostStorySchema.parse(JSON.parse(JSON.stringify(story)))).toEqual(story);
  });

  it('reads back a story whose draft and lead are gone', () => {
    const orphaned = {
      ...story,
      draftId: null,
      title: null,
      leadConversationId: null,
      leadHandle: null,
    };
    expect(outpostStorySchema.parse(orphaned)).toEqual(orphaned);
  });

  it('names the five stack warnings and no others', () => {
    expect(stackWarningKindSchema.options).toEqual([
      'behind_parent',
      'base_merged',
      'base_mismatch',
      'parent_not_pushed',
      'parent_failed',
    ]);
  });

  it('carries stories on an outpost and reads an outpost stored without them', () => {
    const outpost = {
      id: OUTPOST,
      name: 'Orders launch',
      instructions: '',
      pausedAt: null,
      createdAt: AT,
      updatedAt: AT,
      members: [],
      needsYou: 0,
    };
    const detail = { outpost, posts: [], stories: [story] };
    expect(outpostDetailSchema.parse(JSON.parse(JSON.stringify(detail)))).toEqual(detail);
    expect(outpostDetailSchema.parse({ outpost, posts: [] }).stories).toEqual([]);
  });

  it('starts an outpost from a draft with a dependency and an autonomy level per new chat', () => {
    const fresh = (conversationId: string, handle: string, extra: object = {}) => ({
      new: { conversationId, projectId: PROJECT, provider: 'codex', model: null, agentMode: null },
      handle,
      ...extra,
    });
    const request = {
      id: OUTPOST,
      name: 'Orders launch',
      draftId: DRAFT,
      members: [
        { conversationId: LEAD, handle: 'lead' },
        fresh(API, 'api'),
        {
          ...fresh(WEB, 'web', { dependsOn: API }),
          new: { ...fresh(WEB, 'web').new, level: 'full-auto' },
        },
      ],
    };

    expect(createOutpostRequestSchema.parse(JSON.parse(JSON.stringify(request)))).toEqual(request);
    const byHand = { id: OUTPOST, name: 'Orders launch', members: [fresh(API, 'api')] };
    expect(createOutpostRequestSchema.parse(byHand)).toEqual(byHand);
    for (const broken of [
      { ...request, draftId: 'draft' },
      { ...request, members: [fresh(WEB, 'web', { dependsOn: 'api' })] },
      {
        ...request,
        members: [{ ...fresh(WEB, 'web'), new: { ...fresh(WEB, 'web').new, level: 'merge' } }],
      },
    ]) {
      expect(createOutpostRequestSchema.safeParse(broken).success).toBe(false);
    }
  });

  it('says which chat a held request waits for', () => {
    const held = {
      toHandle: 'web',
      closedState: null,
      closedReason: null,
      sent: false,
      queued: false,
      runStatus: null,
      runNeedsYou: null,
      paused: false,
      held: null,
      chatDeleted: false,
      waitingOn: 'api',
    };
    expect(requestFactsSchema.parse(held)).toEqual(held);
    expect(requestFactsSchema.parse({ ...held, waitingOn: null }).waitingOn).toBeNull();
    expect(requestFactsSchema.safeParse({ ...held, waitingOn: undefined }).success).toBe(false);
    expect(requestFactsSchema.parse({ ...held, waitingOn: null, waitingOnDeleted: true })).toEqual({
      ...held,
      waitingOn: null,
      waitingOnDeleted: true,
    });
  });

  it('marks a run started by the user from a draft, and reads a run stored before that', () => {
    const from = {
      postId: POST,
      outpostId: OUTPOST,
      outpostName: 'Orders launch',
      fromHandle: 'lead',
      fromUser: false,
    };
    expect(runSchema.shape.outpost.parse({ ...from, userStarted: true })).toEqual({
      ...from,
      fromSpark: false,
      userStarted: true,
      agentStarted: false,
    });
    expect(runSchema.shape.outpost.parse(from)?.userStarted).toBe(false);
    expect(runSchema.shape.outpost.parse(from)?.agentStarted).toBe(false);
  });

  it('carries a draft line as a run activity', () => {
    const line = { draftId: DRAFT, chats: 4, stacked: 2 };
    expect(OUTPOST_DRAFT_ACTIVITY).toBe('outpost_draft');
    expect(outpostDraftActivitySchema.parse(JSON.parse(JSON.stringify(line)))).toEqual(line);
    expect(outpostDraftActivitySchema.safeParse({ ...line, chats: 0 }).success).toBe(false);
    expect(outpostDraftActivitySchema.safeParse({ ...line, stacked: -1 }).success).toBe(false);
  });
});

function chat(handle: string, dependsOn?: string): StoryChat {
  return dependsOn === undefined ? { handle } : { handle, dependsOn };
}

function task(conversationId: string, position: number, dependsOn: string | null = null) {
  return { conversationId, position, dependsOn } satisfies StoryOrderItem;
}

function ids(tasks: readonly StoryOrderItem[]): string[] {
  return storyOrder(tasks).map((item) => item.conversationId);
}

describe('storyProblems', () => {
  it('finds nothing wrong with parallel chats, a chain and a fan-out', () => {
    expect(storyProblems(draft.chats)).toEqual([]);
    expect(storyProblems([chat('api'), chat('web'), chat('docs')])).toEqual([]);
    expect(storyProblems([chat('web', 'api'), chat('api', 'db'), chat('db')])).toEqual([]);
    expect(storyProblems([chat('api'), chat('web', 'api'), chat('ios', 'api')])).toEqual([]);
    expect(storyProblems([])).toEqual([]);
  });

  it('names a cycle once, from its first chat, as a path back to it', () => {
    expect(storyProblems([chat('a', 'b'), chat('b', 'a')])).toEqual([
      { kind: 'cycle', handle: 'a', text: '@a → @b → @a' },
    ]);
    expect(storyProblems([chat('x'), chat('c', 'a'), chat('a', 'b'), chat('b', 'c')])).toEqual([
      { kind: 'cycle', handle: 'c', text: '@c → @a → @b → @c' },
    ]);
  });

  it('names each of two separate cycles', () => {
    const problems = storyProblems([
      chat('a', 'b'),
      chat('b', 'a'),
      chat('c', 'd'),
      chat('d', 'c'),
    ]);
    expect(problems.map((problem) => problem.text)).toEqual(['@a → @b → @a', '@c → @d → @c']);
  });

  it('does not blame a chat that only leads into a cycle', () => {
    expect(storyProblems([chat('web', 'a'), chat('a', 'b'), chat('b', 'a')])).toEqual([
      { kind: 'cycle', handle: 'a', text: '@a → @b → @a' },
    ]);
  });

  it('reads a chat that depends on itself as self, not as a cycle', () => {
    expect(storyProblems([chat('api', 'api'), chat('web', 'api')])).toEqual([
      { kind: 'self', handle: 'api', text: '@api cannot start after itself.' },
    ]);
  });

  it('refuses a dependency on a handle that is not in the draft', () => {
    expect(storyProblems([chat('api'), chat('web', 'db')])).toEqual([
      {
        kind: 'unknown',
        handle: 'web',
        text: '@web starts after @db, which is not in this draft.',
      },
    ]);
    expect(storyProblems([chat('web', 'toString')]).map((problem) => problem.kind)).toEqual([
      'unknown',
    ]);
  });

  it('reports a handle used more than once a single time', () => {
    expect(storyProblems([chat('api'), chat('web', 'api'), chat('api'), chat('api')])).toEqual([
      { kind: 'duplicate_handle', handle: 'api', text: '@api is used by more than one chat.' },
    ]);
  });

  it('reports every problem of a draft, duplicates first and cycles last', () => {
    const problems = storyProblems([
      chat('a', 'b'),
      chat('b', 'a'),
      chat('web', 'web'),
      chat('ios', 'gone'),
      chat('web'),
    ]);
    expect(problems.map((problem) => [problem.kind, problem.handle])).toEqual([
      ['duplicate_handle', 'web'],
      ['self', 'web'],
      ['unknown', 'ios'],
      ['cycle', 'a'],
    ]);
  });
});

describe('storyOrder', () => {
  it('keeps parallel tasks in position order', () => {
    expect(ids([task('c', 2), task('a', 0), task('b', 1)])).toEqual(['a', 'b', 'c']);
    expect(ids([])).toEqual([]);
  });

  it('puts a task after the one it depends on, whatever its position', () => {
    expect(ids([task('web', 0, 'api'), task('api', 1)])).toEqual(['api', 'web']);
    expect(ids([task('ios', 0, 'web'), task('web', 1, 'api'), task('api', 2)])).toEqual([
      'api',
      'web',
      'ios',
    ]);
  });

  it('keeps a stack together ahead of the next independent task', () => {
    expect(
      ids([task('api', 0), task('docs', 1), task('web', 2, 'api'), task('ios', 3, 'api')]),
    ).toEqual(['api', 'web', 'ios', 'docs']);
  });

  it('treats a dependency outside the story, or on itself, as none', () => {
    expect(ids([task('web', 1, 'deleted'), task('api', 0)])).toEqual(['api', 'web']);
    expect(ids([task('web', 1, 'web'), task('api', 0)])).toEqual(['api', 'web']);
  });

  it('keeps every task of a cycle, once each, and does not loop', () => {
    expect(ids([task('a', 1, 'b'), task('b', 2, 'a'), task('api', 0)])).toEqual(['api', 'a', 'b']);
  });

  it('keeps input order for equal positions and returns the same items without changing the input', () => {
    const first = { ...task('a', 0), title: 'first' };
    const second = { ...task('b', 0), title: 'second' };
    const given = [first, second];
    const ordered = storyOrder(given);
    expect(ordered).toEqual([first, second]);
    expect(ordered[0]).toBe(first);
    expect(given).toEqual([first, second]);
    expect(storyOrder(story.tasks).map((item) => item.handle)).toEqual(['api', 'web']);
  });
});

describe('isStacked', () => {
  it('is stacked on a parent in the same project', () => {
    expect(isStacked({ projectId: PROJECT }, { projectId: PROJECT })).toBe(true);
  });

  it('never stacks an existing chat, which keeps its own branch, but stacks a new chat on one', () => {
    const existing = { projectId: PROJECT, chatId: 'chat-1' };
    expect(isStacked(existing, { projectId: PROJECT })).toBe(false);
    expect(isStacked({ projectId: PROJECT }, existing)).toBe(true);
  });

  it('is order only across projects, with no parent, or with no project', () => {
    expect(isStacked({ projectId: PROJECT }, { projectId: DRAFT })).toBe(false);
    expect(isStacked({ projectId: PROJECT }, null)).toBe(false);
    expect(isStacked({ projectId: null }, { projectId: null })).toBe(false);
    expect(isStacked({ projectId: PROJECT }, { projectId: null })).toBe(false);
  });
});

describe('stackedCount', () => {
  const chat = (handle: string, projectId: string, dependsOn?: string) => ({
    handle,
    projectId,
    ...(dependsOn ? { dependsOn } : {}),
  });

  it('counts the chats that start from another chat in the same project', () => {
    expect(
      stackedCount([
        chat('api', PROJECT),
        chat('web', PROJECT, 'api'),
        chat('docs', DRAFT, 'api'),
        chat('qa', PROJECT, 'web'),
      ]),
    ).toBe(2);
  });

  it('counts none for parallel chats or a parent that is not in the draft', () => {
    expect(stackedCount([chat('api', PROJECT), chat('web', PROJECT)])).toBe(0);
    expect(stackedCount([chat('web', PROJECT, 'api')])).toBe(0);
  });
});
