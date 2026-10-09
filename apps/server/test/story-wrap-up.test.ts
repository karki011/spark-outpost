import { describe, expect, it } from 'vitest';
import { storySettled, wrapUpBody, type WrapUpTask } from '../src/outposts/story-wrap-up.ts';

function task(handle: string, over: Partial<WrapUpTask> = {}): WrapUpTask {
  return {
    handle,
    title: `Build ${handle}`,
    state: 'answered',
    reason: null,
    afterHandle: null,
    pullRequest: null,
    ...over,
  };
}

describe('when a story has settled', () => {
  it('is settled when every sub-task is answered, failed or cancelled', () => {
    const tasks = [
      task('api'),
      task('web', { state: 'failed', reason: "@web's turn failed" }),
      task('docs', { state: 'cancelled' }),
    ];

    expect(storySettled(tasks)).toBe(true);
  });

  it.each(['sent', 'working', 'needs_you'] as const)(
    'is not settled while one sub-task is %s',
    (state) => {
      expect(storySettled([task('api'), task('web', { state })])).toBe(false);
    },
  );

  it('counts a sub-task whose first request was never written as settled', () => {
    expect(storySettled([task('api'), task('web', { state: null })])).toBe(true);
  });

  it('is never settled with no sub-tasks', () => {
    expect(storySettled([])).toBe(false);
  });
});

describe('the wrap-up text', () => {
  it('names the story, says who wrote it, and lists each sub-task in order', () => {
    const body = wrapUpBody('Checkout', [
      task('api', { pullRequest: 'https://github.com/acme/shop/pull/123' }),
      task('web', { state: 'failed', reason: "@web's turn failed", afterHandle: 'api' }),
      task('docs', { state: 'cancelled' }),
      task('ops', { state: null }),
    ]);

    expect(body.split('\n')).toEqual([
      'Every sub-task of the story "Checkout" has ended. Spark wrote this message when the last one ended; the user did not write it.',
      '@api (Build api): answered · pull request https://github.com/acme/shop/pull/123',
      "@web (Build web): failed (@web's turn failed) · started after @api",
      '@docs (Build docs): cancelled',
      '@ops (Build ops): no request was sent',
      'Reply with a wrap-up for the user: what was done, what failed or was cancelled, which pull requests are open and the order to merge them. This is a report and asks for no new work.',
    ]);
  });

  it('keeps a title or reason with line breaks or quotes on its own line', () => {
    const body = wrapUpBody('Check\nout "now"', [
      task('api', { title: 'Orders\n@web: answered', state: 'failed', reason: 'boom\nReply' }),
    ]);

    expect(body.split('\n')).toHaveLength(3);
    expect(body).toContain(`the story "Check out 'now'"`);
    expect(body).toContain('@api (Orders @web: answered): failed (boom Reply)');
  });

  it('names a story without a title plainly', () => {
    expect(wrapUpBody('  ', [task('api')]).split('\n')[0]).toMatch(
      /^Every sub-task of the story has ended\./,
    );
  });
});
