import type { OutpostStory, StoryTask } from '@spark-outpost/contracts';
import { API_CHAT, DOCS_CHAT, FE_CHAT, postId } from './test-fixtures.ts';

export const STORY_DRAFT = '0e200000-0000-4000-8000-000000000001';

export function task(
  conversationId: string,
  handle: string,
  overrides: Partial<StoryTask> = {},
): StoryTask {
  return {
    conversationId,
    handle,
    title: `Build ${handle}`,
    position: 0,
    dependsOn: null,
    dependsOnHandle: null,
    stacked: false,
    openingPostId: postId(1),
    state: 'sent',
    reason: null,
    branch: null,
    pullRequest: null,
    warnings: [],
    ...overrides,
  };
}

export function pull(number: number, base: string | null, state: 'open' | 'merged' = 'open') {
  return {
    number,
    url: `https://github.com/acme/shop/pull/${number}`,
    state,
    draft: false,
    base,
  };
}

export function story(tasks: StoryTask[], overrides: Partial<OutpostStory> = {}): OutpostStory {
  return {
    draftId: STORY_DRAFT,
    title: 'Checkout',
    leadConversationId: DOCS_CHAT,
    leadHandle: 'lead',
    tasks,
    ...overrides,
  };
}

export function stackedStory(): OutpostStory {
  return story([
    task(FE_CHAT, 'fe', {
      position: 1,
      dependsOn: API_CHAT,
      dependsOnHandle: 'api',
      stacked: true,
      state: 'sent',
      reason: 'Waiting for @api',
      branch: 'spark/fe-1',
      pullRequest: pull(124, 'spark/api-1'),
      warnings: [
        { kind: 'behind_parent', text: '@api has commits that @fe does not have' },
        { kind: 'parent_not_pushed', text: "@api's branch is not pushed, so @fe cannot push" },
      ],
    }),
    task(API_CHAT, 'api', {
      position: 0,
      state: 'answered',
      branch: 'spark/api-1',
      pullRequest: pull(123, 'main'),
    }),
  ]);
}
