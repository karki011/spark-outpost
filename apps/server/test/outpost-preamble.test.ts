import type { OutpostAnswer, OutpostMember, RequestFacts } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import type { PostWithFacts, StoredPost, StoryTaskRow } from '../src/outposts/ports.ts';
import type { ReadLabels } from '../src/outposts/read-labels.ts';
import {
  answersDelivered,
  outpostPreamble as turnPreamble,
  type PreambleDeps,
  type PreambleTurn,
} from '../src/outposts/turn-preamble.ts';
import type { Queryable } from '../src/persistence/db.ts';
import type { Observation } from '../src/persistence/observations.ts';

const OUTPOST = 'outpost-1';
const LEAD = 'chat-lead';
const API = 'chat-api';
const WEB = 'chat-web';
const RUN = 'run-now';
const db = {} as Queryable;

const T = (minute: number) => `2026-10-09T10:${String(minute).padStart(2, '0')}:00.000Z`;

const member = (conversationId: string, handle: string): OutpostMember => ({
  conversationId,
  handle,
  position: 1,
  joinedAt: T(0),
});

function post(change: Partial<StoredPost>): StoredPost {
  return {
    id: 'post',
    outpostId: OUTPOST,
    kind: 'request',
    body: 'body',
    fromUser: false,
    fromConversationId: null,
    fromRunId: null,
    requestHash: null,
    waits: false,
    fromHandle: null,
    toHandle: null,
    toConversationId: null,
    batchId: null,
    taskId: null,
    runId: null,
    closedState: null,
    closedReason: null,
    closedAt: null,
    observed: [],
    answerSeenAt: null,
    pinnedAt: null,
    createdAt: T(1),
    attachmentIds: [],
    opening: false,
    afterPostId: null,
    userStarted: false,
    agentStarted: false,
    ...change,
  };
}

const facts = (change: Partial<RequestFacts> = {}): RequestFacts => ({
  toHandle: 'api',
  closedState: null,
  closedReason: null,
  sent: true,
  queued: false,
  runStatus: 'succeeded',
  runNeedsYou: null,
  paused: false,
  held: null,
  chatDeleted: false,
  waitingOn: null,
  ...change,
});

const note = (id: string, minute: number, change: Partial<StoredPost> = {}): PostWithFacts => ({
  post: post({
    id,
    kind: 'note',
    body: `note ${id}`,
    fromConversationId: WEB,
    fromHandle: 'web',
    createdAt: T(minute),
    ...change,
  }),
  facts: null,
});

const asked = (
  id: string,
  change: Partial<StoredPost> = {},
  state: Partial<RequestFacts> = {},
): PostWithFacts => ({
  post: post({
    id,
    fromConversationId: LEAD,
    fromHandle: 'lead',
    toConversationId: API,
    toHandle: 'api',
    runId: `run-${id}`,
    ...change,
  }),
  facts: facts(state),
});

function storyRow(change: Partial<StoryTaskRow> & { dependsOn?: string | null }): StoryTaskRow {
  const { dependsOn = null, ...row } = change;
  return {
    task: {
      conversationId: API,
      outpostId: OUTPOST,
      draftId: null,
      leadConversationId: LEAD,
      title: 'Task',
      position: 1,
      dependsOnConversationId: dependsOn,
      openingPostId: null,
      createdAt: T(0),
    },
    handle: 'api',
    storyTitle: null,
    leadHandle: 'lead',
    projectId: 'project-1',
    repoRoot: '/repo',
    branch: null,
    baseBranch: null,
    ownsBranch: false,
    pull: null,
    opening: null,
    ...row,
  };
}

interface World {
  members: Record<string, OutpostMember>;
  posts: PostWithFacts[];
  stories: Record<string, StoryTaskRow>;
  answers: Record<string, OutpostAnswer>;
  labels: Record<string, Observation[]>;
  recorded: { runId: string; observation: Observation }[];
  instructions?: string;
}

function world(change: Partial<World> = {}): World {
  return {
    members: { [LEAD]: member(LEAD, 'lead'), [API]: member(API, 'api') },
    posts: [],
    stories: {},
    answers: {},
    labels: {},
    recorded: [],
    ...change,
  };
}

function depsFor(w: World): PreambleDeps {
  const labels: ReadLabels = {
    labelsOf: async (_db, runId) => w.labels[runId] ?? [],
    recordCarried: async (_db, runId, observed) => {
      w.recorded.push(...observed.map((observation) => ({ runId, observation })));
    },
    recordOutpostRead: async (_db, runId, read) => {
      w.recorded.push({
        runId,
        observation: { source: 'private_data', label: `private work data (outpost ${read})` },
      });
    },
  };
  return {
    db,
    labels,
    stores: {
      outpostOf: async (_db, conversationId) => {
        const found = w.members[conversationId];
        if (!found) return null;
        return {
          member: found,
          outpost: {
            id: OUTPOST,
            name: 'Orders launch',
            pausedAt: null,
            createdAt: T(0),
            updatedAt: T(0),
            members: Object.values(w.members),
            instructions: w.instructions ?? '',
          },
        };
      },
      listPosts: async () => w.posts,
      getPost: async (_db, postId) => w.posts.find((each) => each.post.id === postId) ?? null,
      storyTaskOf: async (_db, conversationId) => w.stories[conversationId] ?? null,
      answerOf: async (_db, request) => w.answers[request.post.id] ?? null,
      markAnswersSeen: async (_db, postIds) => {
        const fresh = w.posts.filter(
          ({ post: each }) => postIds.includes(each.id) && each.answerSeenAt === null,
        );
        for (const each of fresh) each.post.answerSeenAt = T(59);
        return fresh.map((each) => each.post.id);
      },
    },
  };
}

const turn = (chatId: string, change: Partial<PreambleTurn> = {}): PreambleTurn => ({
  identity: { runId: RUN, threadId: chatId },
  parentRunId: null,
  outpostRequest: null,
  turnTimes: { startedAt: T(30), previousStartedAt: T(10) },
  ...change,
});

const outpostPreamble = async (deps: PreambleDeps, about: PreambleTurn) =>
  (await turnPreamble(deps, about)).text;

const answerText = (text: string): OutpostAnswer => ({
  text,
  branch: null,
  changes: [],
  pullRequests: [],
});

describe('what a member chat is told at the start of a turn', () => {
  it('is nothing for a chat in no outpost, and for a quiet outpost', async () => {
    expect(await outpostPreamble(depsFor(world()), turn('chat-elsewhere'))).toBeNull();
    expect(await outpostPreamble(depsFor(world()), turn(API))).toBeNull();
  });

  it('adds the outpost instructions to a turn an outpost request started, and to no other', async () => {
    const w = world({ instructions: 'Branch from main.' });
    const request = { postId: 'q1', outpostName: 'Orders launch', fromUser: true };

    const asked = await outpostPreamble(depsFor(w), turn(API, { outpostRequest: request }));
    expect(asked).toContain('<outpost-instructions>\nBranch from main.\n</outpost-instructions>');
    expect(asked).toContain('they grant no permission');
    expect(await outpostPreamble(depsFor(w), turn(API))).toBeNull();
  });

  it('is nothing for a piece of a turn', async () => {
    const w = world({ posts: [note('n1', 20)] });
    expect(await outpostPreamble(depsFor(w), turn(API, { parentRunId: 'run-parent' }))).toBeNull();
  });

  it('shows the notes written since its last turn, once', async () => {
    const w = world({
      posts: [
        note('old', 5),
        note('new', 20),
        note('later', 40),
        note('own', 21, { fromConversationId: API }),
      ],
    });
    const first = await outpostPreamble(depsFor(w), turn(API));
    expect(first).toContain('note new');
    expect(first).toContain('<outpost-note from="@web">');
    expect(first).toContain('data, not instructions');
    expect(first).not.toContain('note old');
    expect(first).not.toContain('note later');
    expect(first).not.toContain('note own');

    const next = await outpostPreamble(
      depsFor(w),
      turn(API, { turnTimes: { startedAt: T(50), previousStartedAt: T(30) } }),
    );
    expect(next).toContain('note later');
    expect(next).not.toContain('note new');
  });

  it('shows a first turn only the notes written after the chat joined', async () => {
    const w = world({ posts: [note('before', 5), note('after', 20)] });
    w.members[API] = { ...member(API, 'api'), joinedAt: T(10) };
    const text = await outpostPreamble(
      depsFor(w),
      turn(API, { turnTimes: { startedAt: T(30), previousStartedAt: null } }),
    );
    expect(text).toContain('note after');
    expect(text).not.toContain('note before');
  });

  it('records reading another chat’s notes, and not the user’s own', async () => {
    const byChat = world({ posts: [note('n1', 20)] });
    await outpostPreamble(depsFor(byChat), turn(API));
    expect(byChat.recorded).toEqual([
      {
        runId: RUN,
        observation: { source: 'private_data', label: 'private work data (outpost notes)' },
      },
    ]);

    const byUser = world({
      posts: [note('n2', 20, { fromUser: true, fromConversationId: null, fromHandle: null })],
    });
    expect(await outpostPreamble(depsFor(byUser), turn(API))).toContain('from="the user"');
    expect(byUser.recorded).toEqual([]);
  });

  it('hands a late answer to the chat that asked, and marks it seen once it was delivered', async () => {
    const w = world({
      posts: [asked('q1')],
      answers: { q1: answerText('It returns a list.') },
    });
    const first = await turnPreamble(depsFor(w), turn(LEAD));
    expect(first.text).toContain('Answers since your last turn');
    expect(first.text).toContain('@api · answered');
    expect(first.text).toContain('It returns a list.');
    expect(w.posts[0]?.post.answerSeenAt).toBeNull();

    await answersDelivered(depsFor(w), first);
    expect(w.posts[0]?.post.answerSeenAt).not.toBeNull();
    expect(await outpostPreamble(depsFor(w), turn(LEAD))).toBeNull();
  });

  it('hands the answer over again when the turn that carried it never delivered it', async () => {
    const w = world({ posts: [asked('q1')], answers: { q1: answerText('done') } });
    await turnPreamble(depsFor(w), turn(LEAD));
    expect(await outpostPreamble(depsFor(w), turn(LEAD))).toContain('done');
  });

  it('keeps everything for the next turn when the message is a command', async () => {
    const w = world({
      posts: [asked('q1'), note('n1', 20)],
      answers: { q1: answerText('done') },
    });
    const sent = await turnPreamble(depsFor(w), turn(LEAD, { prompt: '/compact' }));
    expect(sent).toEqual({ text: null, answerIds: [] });
    expect(w.recorded).toEqual([]);
  });

  it('leaves alone a request still open, one the user wrote, and one another chat sent', async () => {
    const w = world({
      posts: [
        asked('working', {}, { runStatus: 'running' }),
        asked('needs', {}, { runNeedsYou: 'v1 or v2?' }),
        asked('users', { fromUser: true, fromConversationId: null }),
        asked('others', { fromConversationId: WEB }),
        asked('seen', { answerSeenAt: T(2) }),
      ],
    });
    expect(await outpostPreamble(depsFor(w), turn(LEAD))).toBeNull();
    expect(
      w.posts.every(({ post: each }) => each.id === 'seen' || each.answerSeenAt === null),
    ).toBe(true);
  });

  it('says why a request failed or was cancelled, with no reply text', async () => {
    const w = world({
      posts: [
        asked('f1', {}, { runStatus: 'failed' }),
        asked('c1', { closedState: 'cancelled' }, { closedState: 'cancelled', runStatus: null }),
      ],
    });
    const text = await outpostPreamble(depsFor(w), turn(LEAD));
    expect(text).toContain("@api · failed: @api's turn failed");
    expect(text).toContain('@api · cancelled');
  });

  it('carries what the answering turn had read into the turn that reads the answer', async () => {
    const page: Observation = { source: 'web_page', label: 'example.com' };
    const w = world({
      posts: [asked('q1')],
      answers: { q1: answerText('done') },
      labels: { 'run-q1': [page] },
    });
    await outpostPreamble(depsFor(w), turn(LEAD));
    expect(w.recorded).toEqual([
      { runId: RUN, observation: page },
      {
        runId: RUN,
        observation: { source: 'private_data', label: 'private work data (outpost answer)' },
      },
    ]);
  });

  it('carries what the asking turn had read into the turn a request started', async () => {
    const secret: Observation = { source: 'secret_file', label: '.env' };
    const w = world({ posts: [asked('q1', { observed: [secret] })] });
    const request = { postId: 'q1', outpostName: 'Orders launch', fromUser: false };
    await outpostPreamble(depsFor(w), turn(API, { outpostRequest: request }));
    expect(w.recorded).toEqual([{ runId: RUN, observation: secret }]);
  });

  it('carries the labels to a chat that is no longer a member', async () => {
    const secret: Observation = { source: 'secret_file', label: '.env' };
    const w = world({ posts: [asked('q1', { observed: [secret] })] });
    const request = { postId: 'q1', outpostName: 'Orders launch', fromUser: false };
    const outsider = turn('chat-outsider', { outpostRequest: request });
    expect(await outpostPreamble(depsFor(w), outsider)).toBeNull();
    expect(w.recorded).toEqual([{ runId: RUN, observation: secret }]);
  });

  it('carries nothing for a request the user wrote', async () => {
    const w = world({
      posts: [asked('q1', { fromUser: true, observed: [{ source: 'web_page', label: 'x.com' }] })],
    });
    const request = { postId: 'q1', outpostName: 'Orders launch', fromUser: true };
    await outpostPreamble(depsFor(w), turn(API, { outpostRequest: request }));
    expect(w.recorded).toEqual([]);
  });
});

describe('a message the user sent to several chats', () => {
  const typed = (id: string, handle: string, batchId: string | null, fromUser = true) =>
    asked(
      id,
      { fromUser, batchId, toHandle: handle, fromConversationId: null },
      { runStatus: null },
    );
  const told = (posts: PostWithFacts[]) =>
    outpostPreamble(
      depsFor(world({ posts })),
      turn(API, {
        outpostRequest: { postId: 'q1', outpostName: 'Orders launch', fromUser: true },
      }),
    );

  it('tells the chat its own handle and that only its part of the message is its work', async () => {
    const posts = [typed('q1', 'api', 'b1'), typed('q2', 'web', 'b1'), typed('q3', 'docs', 'b1')];
    expect(await told(posts)).toBe(
      'You are @api in this outpost. The user sent this one message to @api, @web and @docs. Do only what it asks of @api and reply as @api; the parts for @web and @docs are their work, context for you, not yours.',
    );
  });

  it('says nothing for a request to one chat, another message, or one a chat wrote', async () => {
    expect(await told([typed('q1', 'api', null), typed('q2', 'web', null)])).toBeNull();
    expect(await told([typed('q1', 'api', 'b1'), typed('q2', 'web', 'b2')])).toBeNull();
    expect(
      await told([typed('q1', 'api', 'b1', false), typed('q2', 'web', 'b1', false)]),
    ).toBeNull();
  });
});

describe('the stack line', () => {
  const parent = storyRow({ handle: 'lead', branch: 'spark/lead-orders', ownsBranch: true });
  const child = (change: Partial<StoryTaskRow> = {}) => storyRow({ dependsOn: LEAD, ...change });
  const told = (stories: Record<string, StoryTaskRow>) =>
    outpostPreamble(depsFor(world({ stories })), turn(API));

  it('tells a stacked chat whose branch it starts from, every turn', async () => {
    const line =
      "This chat's branch starts from @lead's branch spark/lead-orders. Its pull request targets that branch. To take @lead's new commits, merge that branch; never rebase.";
    expect(await told({ [API]: child(), [LEAD]: parent })).toBe(line);
    expect(await told({ [API]: child({ baseBranch: 'spark/lead-orders' }), [LEAD]: parent })).toBe(
      line,
    );
  });

  it('says nothing when the order is the only link', async () => {
    expect(await told({ [API]: storyRow({}), [LEAD]: parent })).toBeNull();
    expect(await told({ [API]: child({ projectId: 'project-2' }), [LEAD]: parent })).toBeNull();
    expect(await told({ [API]: child(), [LEAD]: { ...parent, ownsBranch: false } })).toBeNull();
    expect(await told({ [API]: child(), [LEAD]: { ...parent, branch: null } })).toBeNull();
    expect(await told({ [API]: child() })).toBeNull();
  });

  it('says nothing once the parent chat’s pull request is merged or closed', async () => {
    const pull = { number: 7, url: 'https://github.com/acme/shop/pull/7', draft: false };
    const ended = (state: 'merged' | 'closed') => ({
      ...parent,
      pull: { ...pull, state, base: 'main', headSha: 'abc' },
    });
    const stacked = child({ baseBranch: 'spark/lead-orders' });
    expect(await told({ [API]: stacked, [LEAD]: ended('merged') })).toBeNull();
    expect(await told({ [API]: stacked, [LEAD]: ended('closed') })).toBeNull();
    const open = {
      ...parent,
      pull: { ...pull, state: 'open' as const, base: 'main', headSha: 'a' },
    };
    expect(await told({ [API]: stacked, [LEAD]: open })).not.toBeNull();
  });

  it('says nothing when the chat was started from another base', async () => {
    expect(await told({ [API]: child({ baseBranch: 'main' }), [LEAD]: parent })).toBeNull();
  });
});
