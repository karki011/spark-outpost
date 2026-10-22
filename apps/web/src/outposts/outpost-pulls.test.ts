import { describe, expect, it } from 'vitest';
import { outpostPulls } from './outpost-pulls.ts';
import { API_CHAT, chat, post } from './test-fixtures.ts';
import { stackedStory } from './story-fixtures.ts';

const URL = 'https://github.com/acme/shop/pull/12';

const answered = (urls: string[], number = 1) =>
  post(number, {
    state: 'answered',
    answer: { text: 'Done.', branch: 'spark/x', changes: [], pullRequests: urls },
  });

describe('the pull requests of an outpost', () => {
  it('lists each web pull request once, from the latest answer that names it', () => {
    const pulls = outpostPulls(
      [answered([URL, 'not-a-link'], 1), answered([URL], 2)],
      [],
      [chat(API_CHAT)],
    );
    expect(pulls).toEqual([
      {
        url: URL,
        number: 12,
        conversationId: API_CHAT,
        handle: 'api',
        postId: post(2).id,
        state: 'open',
      },
    ]);
  });

  it('counts a chat whose pull request merged as merged', () => {
    const pulls = outpostPulls(
      [answered([URL])],
      [],
      [chat(API_CHAT, { pullRequestMerged: true })],
    );
    expect(pulls[0]?.state).toBe('merged');
  });

  it('takes the state a story knows for that chat and number', () => {
    const story = stackedStory();
    const task = story.tasks.find((each) => each.pullRequest !== null)!;
    const url = task.pullRequest!.url;
    const request = post(1, {
      state: 'answered',
      toConversationId: task.conversationId,
      answer: { text: 'Done.', branch: null, changes: [], pullRequests: [url] },
    });
    const pulls = outpostPulls([request], [story], []);
    expect(pulls[0]?.number).toBe(task.pullRequest!.number);
    expect(pulls[0]?.state).toBe(task.pullRequest!.draft ? 'draft' : task.pullRequest!.state);
  });
});
