import { describe, expect, it } from 'vitest';
import type {
  IsStacked,
  PrBase,
  StackFacts,
  StackWarnings,
  StoryOrder,
  StoryProblems,
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

const facts: StackFacts = {
  handle: 'web',
  parentHandle: 'api',
  defaultBranch: 'main',
  branch: 'spark/orders-page-1a2b3c4d',
  pull: { state: 'open', base: 'spark/orders-endpoint-0a1b2c3d' },
  parentBranch: 'spark/orders-endpoint-0a1b2c3d',
  parentOnRemote: true,
  parentInBranch: false,
  parentState: 'answered',
  parentPull: { state: 'merged' },
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
      held: false,
      chatDeleted: false,
      waitingOn: 'api',
    };
    expect(requestFactsSchema.parse(held)).toEqual(held);
    expect(requestFactsSchema.parse({ ...held, waitingOn: null }).waitingOn).toBeNull();
    expect(requestFactsSchema.safeParse({ ...held, waitingOn: undefined }).success).toBe(false);
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
      userStarted: true,
    });
    expect(runSchema.shape.outpost.parse(from)?.userStarted).toBe(false);
  });

  it('carries a draft line as a run activity', () => {
    const line = { draftId: DRAFT, chats: 4, stacked: 2 };
    expect(OUTPOST_DRAFT_ACTIVITY).toBe('outpost_draft');
    expect(outpostDraftActivitySchema.parse(JSON.parse(JSON.stringify(line)))).toEqual(line);
    expect(outpostDraftActivitySchema.safeParse({ ...line, chats: 0 }).success).toBe(false);
    expect(outpostDraftActivitySchema.safeParse({ ...line, stacked: -1 }).success).toBe(false);
  });

  it('lets the story rules be written against the agreed signatures', () => {
    const rules: {
      storyProblems: StoryProblems;
      storyOrder: StoryOrder;
      isStacked: IsStacked;
      stackWarnings: StackWarnings;
      prBase: PrBase;
    } = {
      storyProblems: (chats) =>
        chats
          .filter((chat) => chat.dependsOn === chat.handle)
          .map((chat) => ({ kind: 'self', handle: chat.handle, text: `@${chat.handle}` })),
      storyOrder: (tasks) => tasks.toSorted((a, b) => a.position - b.position),
      isStacked: (task, parent) => parent !== null && task.projectId === parent.projectId,
      stackWarnings: (given) =>
        given.parentPull?.state === 'merged' ? [{ kind: 'base_merged', text: 'x' }] : [],
      prBase: (given) => given.parentBranch ?? given.defaultBranch,
    };

    expect(rules.storyProblems(draft.chats)).toEqual([]);
    expect(rules.storyOrder(story.tasks).map((task) => task.handle)).toEqual(['api', 'web']);
    expect(rules.isStacked({ projectId: PROJECT }, { projectId: PROJECT })).toBe(true);
    expect(rules.stackWarnings(facts).map((warning) => warning.kind)).toEqual(['base_merged']);
    expect(rules.prBase(facts)).toBe('spark/orders-endpoint-0a1b2c3d');
  });
});
