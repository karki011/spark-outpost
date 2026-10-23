import { describe, expect, it } from 'vitest';
import { threadItems } from '@spark-outpost/contracts';
import type { OutpostPull } from './outpost-pulls.ts';
import { groupCards, requestTitle, requestsOf, threadCard, waitsOnYou } from './thread-cards.ts';
import { note, post } from './test-fixtures.ts';

const URL = 'https://github.com/acme/shop/pull/7';

function pull(state: OutpostPull['state']): OutpostPull {
  return { url: URL, number: 7, conversationId: null, handle: 'api', postId: post(1).id, state };
}

const answered = (text = 'Done.') =>
  post(1, {
    state: 'answered',
    answer: { text, branch: null, changes: [], pullRequests: [URL] },
  });

describe('a request card', () => {
  it.each([
    ['sent', 'working', 'Queued'],
    ['working', 'working', 'Working'],
    ['needs_you', 'waiting', 'Waiting on you'],
    ['failed', 'waiting', 'Failed'],
    ['cancelled', 'done', 'Cancelled'],
  ] as const)('puts a %s request under %s with the word %s', (state, status, pill) => {
    const card = threadCard(post(1, { state }), []);
    expect(card.status).toBe(status);
    expect(card.pill).toBe(pill);
  });

  it('holds a request that waits for another chat, whatever its state says', () => {
    expect(threadCard(post(1, { held: true }), []).status).toBe('held');
  });

  it('is ready for review while its pull request is open, and done once it is merged or closed', () => {
    expect(threadCard(answered(), [pull('open')]).status).toBe('review');
    expect(threadCard(answered(), [pull('draft')]).status).toBe('review');
    expect(threadCard(answered(), [pull('merged')])).toMatchObject({
      status: 'done',
      pill: 'Done',
    });
    expect(threadCard(answered(), [pull('closed')]).status).toBe('done');
    expect(threadCard(answered(), []).status).toBe('idle');
  });

  it('sums an answer up in plain text, leaving out what it asks the user', () => {
    const card = threadCard(
      post(1, {
        state: 'needs_you',
        reason: null,
        answer: {
          text: 'I can **move** it.\n\nNeeds you: hourly or every 4 hours?',
          branch: null,
          changes: [],
          pullRequests: [],
        },
      }),
      [],
    );
    expect(card.summary).toBe('I can move it.');
  });

  it('shows the question as the summary of a request that waits on the user', () => {
    const card = threadCard(post(1, { state: 'needs_you', reason: 'Which region?' }), []);
    expect(card.summary).toBe('Which region?');
  });

  it('shows the live activity of a working request', () => {
    expect(threadCard(post(1, { state: 'working' }), [], 'Running tests').summary).toBe(
      'Running tests',
    );
  });
});

describe('the title of a request', () => {
  it('is its first line without the handles, links or Markdown marks', () => {
    expect(requestTitle('@api @fe  Add **last_active_at** to [the job](x)\nmore')).toBe(
      'Add last_active_at to the job',
    );
  });

  it('is the first line addressed to its own chat when one message asks several', () => {
    const body = '@api Add the endpoint\n\n@web Draw the page for it';
    expect(requestTitle(body, 'web')).toBe('Draw the page for it');
    expect(requestTitle(body, 'api')).toBe('Add the endpoint');
    expect(requestTitle('Please, @api and @web: ship it', 'web')).toBe(
      'Please, @api and @web: ship it',
    );
  });

  it('skips empty lines, cuts a long line, and has a fallback', () => {
    expect(requestTitle('\n\n@api Fix it')).toBe('Fix it');
    expect(requestTitle('x'.repeat(200))).toHaveLength(80);
    expect(requestTitle('@api')).toBe('Request');
  });
});

describe('grouping threads in Overview', () => {
  it('orders the groups as the user acts on them, newest first in each, and leaves out empty ones', () => {
    const items = threadItems([
      post(1, { state: 'answered' }),
      post(2, { state: 'needs_you' }),
      post(3, { state: 'working' }),
      note(4),
      post(5, { state: 'answered' }),
    ]);
    const cards = requestsOf(items).map((request) => threadCard(request, []));
    const groups = groupCards(cards);
    expect(groups.map((group) => group.status)).toEqual(['waiting', 'working', 'idle']);
    expect(groups[2]?.cards.map((card) => card.post.id)).toEqual([post(5).id, post(1).id]);
    expect(waitsOnYou(cards)).toBe(1);
  });
});
