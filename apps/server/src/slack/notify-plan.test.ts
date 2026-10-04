import { describe, expect, it } from 'vitest';
import { slackSettingsSchema } from '@spark-outpost/contracts';
import {
  NotifyBatcher,
  notificationText,
  notifyDecision,
  notifyLine,
  notifyTarget,
  threadUpdateText,
  type NotifyCandidate,
} from './notify-plan.ts';

const settings = slackSettingsSchema.parse({});
const candidate = (fields: Partial<NotifyCandidate> = {}): NotifyCandidate => ({
  key: 'run:1',
  event: 'finished',
  detail: null,
  url: null,
  ...fields,
});

describe('notifyDecision', () => {
  it('sends when the event is on, a target exists and Spark is not focused', () => {
    expect(notifyDecision(candidate(), { settings, focused: false, target: 'U1' })).toBe('send');
  });

  it('skips events that are switched off before anything else', () => {
    expect(
      notifyDecision(candidate({ event: 'flag' }), { settings, focused: true, target: null }),
    ).toBe('off');
  });

  it('skips when there is nobody to tell', () => {
    expect(notifyDecision(candidate(), { settings, focused: false, target: null })).toBe(
      'no_target',
    );
  });

  it('stays quiet while focused only when quiet is on', () => {
    expect(notifyDecision(candidate(), { settings, focused: true, target: 'U1' })).toBe('focused');
    const loud = { ...settings, quietWhenFocused: false };
    expect(notifyDecision(candidate(), { settings: loud, focused: true, target: 'U1' })).toBe(
      'send',
    );
  });
});

describe('notifyTarget', () => {
  it('prefers the chosen channel over the direct message', () => {
    expect(notifyTarget('U1', settings)).toBe('U1');
    expect(notifyTarget('U1', { ...settings, notifyChannelId: 'C1' })).toBe('C1');
    expect(notifyTarget(null, settings)).toBeNull();
  });
});

describe('notification wording', () => {
  it('maps approval kinds to approval, plan, review and question', () => {
    const line = (detail: string) => notifyLine(candidate({ event: 'needs_you', detail }));
    expect(line('execute')).toBe('Needs your approval');
    expect(line('spark_action')).toBe('Needs your approval');
    expect(line('pieces')).toBe('Has a plan for you to review');
    expect(line('accept')).toBe('Has changes for you to review');
    expect(line('budget')).toBe('Has a question for you');
  });

  it('only prints pull request links that look like pull requests', () => {
    const line = (url: string) => notifyLine(candidate({ event: 'pr_opened', url }));
    expect(line('https://github.com/acme/web/pull/7')).toContain(
      'https://github.com/acme/web/pull/7',
    );
    expect(line('https://evil.test/x?<!channel>')).toBe('Opened a pull request');
  });

  it('escapes and redacts the title, trims it and links the chat', () => {
    const text = notificationText(
      {
        conversationId: '3f0c9a52-6f0e-4d53-9a35-0d1f5a4b7c11',
        title: '<@U1> key xoxb-1111111111-abcdefghijk',
        project: 'web & api',
      },
      [candidate(), candidate({ key: 'run:2' })],
      'spark-outpost-dev',
    );
    expect(text).toContain('&lt;@U1&gt;');
    expect(text).not.toContain('xoxb-1111111111');
    expect(text).toContain('· web &amp; api');
    expect(text).toContain('• Finished (2)');
    expect(text).toContain(
      '<spark-outpost-dev://chat/3f0c9a52-6f0e-4d53-9a35-0d1f5a4b7c11|Open in Spark>',
    );
  });

  it('posts thread updates only for finished, failed and pull requests', () => {
    expect(threadUpdateText(candidate())).toBe('Spark finished this work.');
    expect(threadUpdateText(candidate({ event: 'needs_you' }))).toBeNull();
    expect(threadUpdateText(candidate({ event: 'flag' }))).toBeNull();
  });
});

describe('NotifyBatcher', () => {
  function fakeTimers() {
    const pending = new Map<number, () => void>();
    let next = 0;
    return {
      pending,
      timers: {
        set: (run: () => void) => {
          next += 1;
          pending.set(next, run);
          return next;
        },
        clear: (handle: unknown) => {
          pending.delete(handle as number);
        },
      },
    };
  }

  it('collects everything for a chat until its one timer fires', () => {
    const flushed: [string, string[]][] = [];
    const { pending, timers } = fakeTimers();
    const batcher = new NotifyBatcher<string>(
      1000,
      (key, items) => flushed.push([key, items]),
      timers,
    );
    batcher.add('chat-a', 'one');
    batcher.add('chat-a', 'two');
    batcher.add('chat-b', 'other');

    expect(pending.size).toBe(2);
    expect(flushed).toEqual([]);
    [...pending.values()][0]!();
    expect(flushed).toEqual([['chat-a', ['one', 'two']]]);

    batcher.add('chat-a', 'three');
    batcher.releaseAll();
    expect(flushed.slice(1)).toEqual([
      ['chat-b', ['other']],
      ['chat-a', ['three']],
    ]);
    expect(pending.size).toBe(0);
  });
});
