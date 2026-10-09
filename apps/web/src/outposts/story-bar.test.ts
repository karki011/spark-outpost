import { describe, expect, it } from 'vitest';
import { storyBarView } from './story-bar.ts';
import { pull, stackedStory, story, task } from './story-fixtures.ts';
import { API_CHAT, DOCS_CHAT, FE_CHAT } from './test-fixtures.ts';

describe('storyBarView', () => {
  it('orders a sub-task under the one it starts after and counts what is done', () => {
    const view = storyBarView(stackedStory(), 0);
    expect(view.title).toBe('Checkout');
    expect(view.rows.map((row) => row.handle)).toEqual(['api', 'fe']);
    expect(view.summary).toBe('1 of 2 answered · 2 PRs · 2 warnings');
  });

  it('names a stacked pull request by the pull request it targets', () => {
    const [api, fe] = storyBarView(stackedStory(), 0).rows;
    expect(api?.pull).toMatchObject({ label: '#123 → main', mark: 'open' });
    expect(fe?.pull).toMatchObject({
      label: '#124 → #123',
      name: 'Pull request #124 into #123, open',
      url: 'https://github.com/acme/shop/pull/124',
    });
    expect(fe?.order).toBe('on @api');
    expect(api?.order).toBeNull();
  });

  it('shows the branch when the base is not the parent pull request', () => {
    const view = storyBarView(
      story([
        task(API_CHAT, 'api', { branch: 'spark/api-1' }),
        task(FE_CHAT, 'fe', {
          position: 1,
          dependsOn: API_CHAT,
          dependsOnHandle: 'api',
          pullRequest: { ...pull(124, 'spark/api-1'), draft: true },
        }),
        task(DOCS_CHAT, 'docs', { position: 2, pullRequest: pull(125, null, 'merged') }),
      ]),
      0,
    );
    expect(view.rows.map((row) => row.pull?.label)).toEqual([
      undefined,
      '#124 → spark/api-1',
      '#125',
    ]);
    expect(view.rows.map((row) => row.pull?.mark)).toEqual([undefined, 'draft', 'merged']);
    expect(view.rows[1]?.order).toBe('after @api');
    expect(view.summary).toBe('0 of 3 answered · 2 PRs');
  });

  it('says why a sub-task waits and what was never started', () => {
    const view = storyBarView(
      story([
        task(API_CHAT, 'api', { state: null, openingPostId: null }),
        task(FE_CHAT, 'fe', { position: 1, reason: 'Waiting for @api' }),
        task(DOCS_CHAT, 'docs', { position: 2, state: 'answered', reason: 'ignored' }),
      ]),
      0,
    );
    expect(view.rows.map((row) => [row.stateLabel, row.note])).toEqual([
      ['Not started', null],
      ['Sent', 'Waiting for @api'],
      ['Answered', null],
    ]);
  });

  it('offers a message to send for a sub-task that is behind or targets a merged branch', () => {
    const [, fe] = storyBarView(stackedStory(), 0).rows;
    expect(fe?.warnings.map((warning) => warning.fill)).toEqual([
      {
        label: 'Update from @api',
        text: '@fe merge spark/api-1 into your branch, fix any conflicts and run the checks.',
      },
      null,
    ]);
    const merged = storyBarView(
      story([
        task(FE_CHAT, 'fe', {
          warnings: [{ kind: 'base_merged', text: 'Merging this now would not reach main' }],
        }),
      ]),
      0,
    ).rows[0];
    expect(merged?.warnings[0]?.fill?.label).toBe('Update from the default branch');
    expect(merged?.warnings[0]?.fill?.text).toContain('gh pr edit --base');
  });

  it('keys a story without a draft by its place and calls it untitled', () => {
    const view = storyBarView(story([], { draftId: null, title: null }), 2);
    expect(view).toMatchObject({ key: 'story-2', title: 'Untitled', summary: '0 of 0 answered' });
  });
});
