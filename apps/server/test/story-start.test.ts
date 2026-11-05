import { describe, expect, it } from 'vitest';
import type { CreateOutpostRequest, StartMember } from '@spark-outpost/contracts';
import type { StoredDraft } from '../src/outposts/ports.ts';
import {
  DRAFT_ALREADY_STARTED,
  DRAFT_OTHER_OUTPOST,
  LEAD_CHAT_GONE,
  LEAD_HAS_FIRST_MESSAGE,
  LEAD_NOT_IN_OUTPOST,
  nothingToHold,
  planStory,
  startsAfterUnknown,
} from '../src/outposts/story-start.ts';

const OUTPOST = '0f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const OTHER_OUTPOST = '9f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const LEAD = '1f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const API = '2f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const WEB = '3f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const DOCS = '7f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const PROJECT = '4f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const DRAFT = '5f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const API_POST = '6a0e0d0c-1a2b-4c3d-8e9f-001122334455';
const WEB_POST = '6b0e0d0c-1a2b-4c3d-8e9f-001122334455';
const DOCS_POST = '6c0e0d0c-1a2b-4c3d-8e9f-001122334455';

function draft(overrides: Partial<StoredDraft> = {}): StoredDraft {
  return {
    id: DRAFT,
    workspaceId: PROJECT,
    conversationId: LEAD,
    runId: null,
    outpostId: null,
    title: 'Checkout',
    body: {
      title: 'Checkout',
      chats: [
        { handle: 'api', title: 'Orders endpoint', projectId: PROJECT, task: 'Add the endpoint.' },
        {
          handle: 'web',
          title: 'Orders page',
          projectId: PROJECT,
          task: 'Build the page.',
          dependsOn: 'api',
        },
      ],
    },
    startedAt: null,
    reportedAt: null,
    createdAt: '2026-10-09T10:00:00.000Z',
    ...overrides,
  };
}

function chat(
  conversationId: string,
  handle: string,
  post: string | null,
  dependsOn?: string,
): StartMember {
  return {
    new: { conversationId, projectId: PROJECT, provider: 'codex', model: null, agentMode: null },
    handle,
    ...(post ? { firstMessage: { id: post, text: `Task for ${handle}`, attachmentIds: [] } } : {}),
    ...(dependsOn ? { dependsOn } : {}),
  };
}

const lead: StartMember = { conversationId: LEAD, handle: 'lead' };

function request(members: StartMember[], id = OUTPOST): CreateOutpostRequest {
  return { id, name: 'Orders launch', members, draftId: DRAFT };
}

function refusalOf(plan: ReturnType<typeof planStory>): string | null {
  return plan.kind === 'refusal' ? plan.message : null;
}

describe('planning a story from a draft the user starts', () => {
  it('writes every first message as the lead chat, started by the user, never as the user', () => {
    const plan = planStory(
      draft(),
      request([lead, chat(API, 'api', API_POST), chat(WEB, 'web', WEB_POST, API)]),
      'lead',
    );

    if (plan.kind !== 'plan') throw new Error(plan.message);
    expect(plan.lead).toEqual({ conversationId: LEAD, handle: 'lead' });
    expect(plan.posts).toEqual([
      {
        id: API_POST,
        outpostId: OUTPOST,
        body: 'Task for api',
        fromConversationId: LEAD,
        fromHandle: 'lead',
        toHandle: 'api',
        toConversationId: API,
        attachmentIds: [],
        afterPostId: null,
      },
      {
        id: WEB_POST,
        outpostId: OUTPOST,
        body: 'Task for web',
        fromConversationId: LEAD,
        fromHandle: 'lead',
        toHandle: 'web',
        toConversationId: WEB,
        attachmentIds: [],
        afterPostId: API_POST,
      },
    ]);
    expect(plan.tasks).toEqual([
      {
        conversationId: API,
        outpostId: OUTPOST,
        draftId: DRAFT,
        leadConversationId: LEAD,
        title: 'Orders endpoint',
        position: 0,
        dependsOnConversationId: null,
        openingPostId: API_POST,
      },
      {
        conversationId: WEB,
        outpostId: OUTPOST,
        draftId: DRAFT,
        leadConversationId: LEAD,
        title: 'Orders page',
        position: 1,
        dependsOnConversationId: API,
        openingPostId: WEB_POST,
      },
    ]);
  });

  it('puts a parent before the chat that starts after it, whatever order the sheet sent', () => {
    const plan = planStory(
      draft(),
      request([chat(WEB, 'web', WEB_POST, API), lead, chat(API, 'api', API_POST)]),
      'lead',
    );

    if (plan.kind !== 'plan') throw new Error(plan.message);
    expect(plan.posts.map((post) => post.id)).toEqual([API_POST, WEB_POST]);
    expect(plan.tasks.map((task) => [task.conversationId, task.position])).toEqual([
      [API, 1],
      [WEB, 0],
    ]);
  });

  it('titles a chat the user renamed or added from its first line', () => {
    const plan = planStory(draft(), request([lead, chat(DOCS, 'docs', DOCS_POST)]), 'lead');

    if (plan.kind !== 'plan') throw new Error(plan.message);
    expect(plan.tasks.map((task) => task.title)).toEqual(['Task for docs']);
  });

  it('leaves a member without a first message out of the story', () => {
    const plan = planStory(draft(), request([lead, chat(API, 'api', null)]), 'lead');

    expect(plan).toMatchObject({ kind: 'plan', tasks: [], posts: [] });
  });

  it('refuses a draft whose lead chat is gone or is not in the outpost', () => {
    const members = [lead, chat(API, 'api', API_POST)];

    expect(refusalOf(planStory(draft({ conversationId: null }), request(members), 'lead'))).toBe(
      LEAD_CHAT_GONE,
    );
    expect(refusalOf(planStory(draft(), request(members), null))).toBe(LEAD_NOT_IN_OUTPOST);
  });

  it('refuses a draft started in another outpost and allows the same outpost again', () => {
    const members = [lead, chat(API, 'api', API_POST)];
    const started = draft({ outpostId: OUTPOST, startedAt: '2026-10-09T10:05:00.000Z' });

    expect(refusalOf(planStory(started, request(members, OTHER_OUTPOST), 'lead'))).toBe(
      DRAFT_ALREADY_STARTED,
    );
    expect(planStory(started, request(members), 'lead').kind).toBe('plan');
    expect(
      refusalOf(planStory(draft({ outpostId: OUTPOST }), request(members, OTHER_OUTPOST), 'lead')),
    ).toBe(DRAFT_OTHER_OUTPOST);
  });

  it('refuses a first message to the lead itself', () => {
    const toLead: StartMember = {
      conversationId: LEAD,
      handle: 'lead',
      firstMessage: { id: DOCS_POST, text: 'Hello me', attachmentIds: [] },
    };

    expect(refusalOf(planStory(draft(), request([toLead]), 'lead'))).toBe(LEAD_HAS_FIRST_MESSAGE);
  });

  it('refuses chats that wait for each other and names the loop', () => {
    const plan = planStory(
      draft(),
      request([lead, chat(API, 'api', API_POST, WEB), chat(WEB, 'web', WEB_POST, API)]),
      'lead',
    );

    expect(refusalOf(plan)).toBe('These chats wait for each other: @api → @web → @api.');
  });

  it('refuses a chat that starts after itself, after an unknown chat or with nothing to hold', () => {
    expect(
      refusalOf(planStory(draft(), request([lead, chat(API, 'api', API_POST, API)]), 'lead')),
    ).toBe('@api cannot start after itself.');
    expect(
      refusalOf(planStory(draft(), request([lead, chat(WEB, 'web', WEB_POST, DOCS)]), 'lead')),
    ).toBe(startsAfterUnknown('web'));
    expect(
      refusalOf(
        planStory(
          draft(),
          request([lead, chat(API, 'api', null), chat(WEB, 'web', WEB_POST, API)]),
          'lead',
        ),
      ),
    ).toBe(startsAfterUnknown('web'));
    expect(
      refusalOf(
        planStory(
          draft(),
          request([lead, chat(API, 'api', API_POST), chat(WEB, 'web', null, API)]),
          'lead',
        ),
      ),
    ).toBe(nothingToHold('web'));
  });

  it('refuses two chats with the same handle and a stored draft that has a problem', () => {
    expect(
      refusalOf(
        planStory(
          draft(),
          request([lead, chat(API, 'api', API_POST), chat(WEB, 'api', WEB_POST)]),
          'lead',
        ),
      ),
    ).toBe('@api is used by more than one chat.');
    const looping = draft();
    looping.body.chats[0] = { ...looping.body.chats[0]!, dependsOn: 'web' };

    expect(refusalOf(planStory(looping, request([lead, chat(API, 'api', API_POST)]), 'lead'))).toBe(
      'These chats wait for each other: @api → @web → @api.',
    );
  });
});
