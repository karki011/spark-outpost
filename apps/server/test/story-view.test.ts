import { describe, expect, it } from 'vitest';
import type { RequestFacts, RunStatus } from '@spark-outpost/contracts';
import type { StackGit, StoredPost, StoryTaskRow } from '../src/outposts/ports.ts';
import { toStories, UNKNOWN_STACK } from '../src/outposts/story-view.ts';

const OUTPOST = '0f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const LEAD = '1f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const API = '2f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const WEB = '3f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const DOCS = '7f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const PROJECT = '4f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const OTHER_PROJECT = '8f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const DRAFT = '5f0e0d0c-1a2b-4c3d-8e9f-001122334455';
const LATER_DRAFT = '5a0e0d0c-1a2b-4c3d-8e9f-001122334455';
const AT = '2026-10-09T10:00:00.000Z';

function opening(
  handle: string,
  runStatus: RunStatus | null,
  waitingOn: string | null = null,
): NonNullable<StoryTaskRow['opening']> {
  const facts: RequestFacts = {
    toHandle: handle,
    closedState: null,
    closedReason: null,
    sent: runStatus !== null,
    queued: false,
    runStatus,
    runNeedsYou: null,
    paused: false,
    held: null,
    chatDeleted: false,
    waitingOn,
  };
  return { post: { id: `${handle}-post` } as StoredPost, facts };
}

interface RowInput extends Partial<Omit<StoryTaskRow, 'task'>> {
  conversationId: string;
  handle: string;
  position: number;
  dependsOn?: string;
  draftId?: string | null;
}

function row(input: RowInput): StoryTaskRow {
  const { conversationId, position, dependsOn, draftId = DRAFT, ...rest } = input;
  return {
    task: {
      conversationId,
      outpostId: OUTPOST,
      draftId,
      leadConversationId: LEAD,
      title: `Task ${input.handle}`,
      position,
      dependsOnConversationId: dependsOn ?? null,
      openingPostId: null,
      createdAt: AT,
    },
    storyTitle: 'Checkout',
    leadHandle: 'lead',
    projectId: PROJECT,
    repoRoot: '/repos/shop',
    branch: null,
    baseBranch: null,
    ownsBranch: false,
    pull: null,
    opening: null,
    ...rest,
  };
}

function fakeGit(answers: { ancestor?: boolean; onRemote?: boolean } = {}) {
  const asked: string[] = [];
  const git: StackGit = {
    async isAncestor(repoRoot, ancestor, descendant) {
      asked.push(`ancestor ${repoRoot} ${ancestor} ${descendant}`);
      return answers.ancestor ?? true;
    },
    async branchOnRemote(repoRoot, branch) {
      asked.push(`remote ${repoRoot} ${branch}`);
      return answers.onRemote ?? true;
    },
  };
  return { git, asked };
}

const api = row({
  conversationId: API,
  handle: 'api',
  position: 0,
  branch: 'spark/api',
  baseBranch: 'main',
  ownsBranch: true,
  opening: opening('api', 'succeeded'),
  pull: {
    number: 123,
    url: 'https://github.com/acme/shop/pull/123',
    state: 'open',
    draft: false,
    base: 'main',
    headSha: 'aaa',
  },
});

const web = row({
  conversationId: WEB,
  handle: 'web',
  position: 1,
  dependsOn: API,
  branch: 'spark/web',
  baseBranch: 'spark/api',
  ownsBranch: true,
  opening: opening('web', 'running'),
  pull: {
    number: 124,
    url: 'https://github.com/acme/shop/pull/124',
    state: 'open',
    draft: true,
    base: 'spark/api',
    headSha: 'bbb',
  },
});

describe('the stories of an outpost', () => {
  it('lists a story in order with each state, branch, pull request and what it is stacked on', async () => {
    const { git, asked } = fakeGit();

    const stories = await toStories([web, api], git);

    expect(stories).toEqual([
      {
        draftId: DRAFT,
        title: 'Checkout',
        leadConversationId: LEAD,
        leadHandle: 'lead',
        tasks: [
          {
            conversationId: API,
            handle: 'api',
            title: 'Task api',
            position: 0,
            dependsOn: null,
            dependsOnHandle: null,
            stacked: false,
            openingPostId: null,
            state: 'answered',
            reason: null,
            branch: 'spark/api',
            pullRequest: {
              number: 123,
              url: 'https://github.com/acme/shop/pull/123',
              state: 'open',
              draft: false,
              base: 'main',
            },
            warnings: [],
          },
          {
            conversationId: WEB,
            handle: 'web',
            title: 'Task web',
            position: 1,
            dependsOn: API,
            dependsOnHandle: 'api',
            stacked: true,
            openingPostId: null,
            state: 'working',
            reason: null,
            branch: 'spark/web',
            pullRequest: {
              number: 124,
              url: 'https://github.com/acme/shop/pull/124',
              state: 'open',
              draft: true,
              base: 'spark/api',
            },
            warnings: [],
          },
        ],
      },
    ]);
    expect(asked).toEqual([
      'remote /repos/shop spark/api',
      'ancestor /repos/shop spark/api spark/web',
    ]);
  });

  it('warns when the parent has new commits, is not pushed or failed', async () => {
    const failed = { ...api, opening: opening('api', 'failed') };
    const { git } = fakeGit({ ancestor: false, onRemote: false });

    const [story] = await toStories([failed, web], git);

    expect(story?.tasks[1]?.warnings.map((warning) => warning.kind)).toEqual([
      'parent_failed',
      'parent_not_pushed',
      'behind_parent',
    ]);
  });

  it('warns that a pull request still targets a merged parent, using the root default branch', async () => {
    const merged = { ...api, pull: { ...api.pull!, state: 'merged' as const } };
    const { git } = fakeGit();

    const [story] = await toStories([merged, web], git);

    expect(story?.tasks[1]?.warnings).toEqual([
      { kind: 'base_merged', text: 'Merging this now would not reach main' },
    ]);
  });

  it('orders a chat in another repo after its parent without stacking it or asking git', async () => {
    const docs = row({
      conversationId: DOCS,
      handle: 'docs',
      position: 0,
      dependsOn: API,
      projectId: OTHER_PROJECT,
      opening: opening('docs', null, 'api'),
    });
    const { git, asked } = fakeGit({ onRemote: false });

    const [story] = await toStories([docs, { ...api, task: { ...api.task, position: 1 } }], git);

    expect(story?.tasks.map((task) => task.handle)).toEqual(['api', 'docs']);
    expect(story?.tasks[1]).toMatchObject({
      stacked: false,
      dependsOnHandle: 'api',
      state: 'sent',
      reason: 'Waiting for @api',
      warnings: [],
    });
    expect(asked).toEqual([]);
  });

  it('raises no git warning when the repository cannot be asked', async () => {
    const [story] = await toStories([api, web], UNKNOWN_STACK);

    expect(story?.tasks[1]).toMatchObject({ stacked: true, warnings: [] });
  });

  it('keeps a dependent whose parent chat is gone, with no parent and no state for a missing post', async () => {
    const orphan = row({ conversationId: WEB, handle: 'web', position: 1, dependsOn: API });

    const [story] = await toStories([orphan], fakeGit().git);

    expect(story?.tasks).toEqual([
      expect.objectContaining({
        dependsOn: API,
        dependsOnHandle: null,
        stacked: false,
        state: null,
        reason: null,
        pullRequest: null,
      }),
    ]);
  });

  it('keeps two stories apart and groups tasks that lost their draft', async () => {
    const later = row({ conversationId: DOCS, handle: 'docs', position: 0, draftId: LATER_DRAFT });
    const loose = row({
      conversationId: LEAD,
      handle: 'old',
      position: 0,
      draftId: null,
      storyTitle: null,
      leadHandle: null,
    });

    const stories = await toStories([api, later, web, loose], fakeGit().git);

    expect(stories.map((story) => [story.draftId, story.tasks.map((task) => task.handle)])).toEqual(
      [
        [DRAFT, ['api', 'web']],
        [LATER_DRAFT, ['docs']],
        [null, ['old']],
      ],
    );
    expect(stories[2]).toMatchObject({ title: null, leadHandle: null });
  });
});
