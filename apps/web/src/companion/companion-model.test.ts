import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import {
  companionFeed,
  companionMood,
  errorKey,
  finishedRunIds,
  nearestCorner,
  runningDots,
  runStatuses,
  statusLabel,
  statusText,
} from './companion-model.ts';

let next = 0;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function chat(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  next += 1;
  return {
    id: uuid(next),
    title: `Chat ${next}`,
    updatedAt: `2026-09-26T10:${String(next).padStart(2, '0')}:00.000Z`,
    projectIds: [],
    latestRun: null,
    archivedAt: null,
    pinnedAt: null,
    pinnedOrder: null,
    projectOrder: null,
    unread: false,
    needsInput: false,
    attention: null,
    titleSource: 'message',
    category: null,
    ...overrides,
  };
}

function run(status: string, extra: Partial<NonNullable<ConversationSummary['latestRun']>> = {}) {
  next += 1;
  return {
    id: uuid(500 + next),
    status,
    error: null,
    step: null,
    provider: 'claude',
    progress: null,
    ...extra,
  } as ConversationSummary['latestRun'];
}

const asking = (title = 'Asking') =>
  chat({ title, needsInput: true, latestRun: run('awaiting_approval') });
const failed = (title = 'Failed') =>
  chat({ title, latestRun: run('failed', { error: 'Rate limit reached.' }) });
const finished = (title = 'Finished') => chat({ title, unread: true, latestRun: run('succeeded') });
const working = (title = 'Working') => chat({ title, latestRun: run('running') });

const calm = { celebrating: false, seenErrors: new Set<string>() };

describe('companionFeed', () => {
  it('splits chats into needs you, running, finished and errors', () => {
    const feed = companionFeed(
      [
        asking('Deploy'),
        working('Refactor'),
        finished('Notes'),
        failed('Fetch'),
        chat({ title: 'Idle' }),
        asking('Archived'),
      ].map((entry) =>
        entry.title === 'Archived' ? { ...entry, archivedAt: entry.updatedAt } : entry,
      ),
    );
    expect(feed.needs.map((item) => item.chat.title)).toEqual(['Deploy']);
    expect(feed.running.map((item) => item.chat.title)).toEqual(['Refactor']);
    expect(feed.finished.map((item) => item.chat.title)).toEqual(['Notes']);
    expect(feed.errors.map((item) => item.chat.title)).toEqual(['Fetch']);
  });

  it('keeps only the three latest finished chats, newest first', () => {
    const chats = ['A', 'B', 'C', 'D'].map((title) => finished(title));
    expect(companionFeed(chats).finished.map((item) => item.chat.title)).toEqual(['D', 'C', 'B']);
  });
});

describe('companionMood', () => {
  it('is idle when nothing is going on', () => {
    expect(companionMood(companionFeed([chat()]), calm)).toBe('idle');
  });

  it('works while agents run', () => {
    expect(companionMood(companionFeed([working()]), calm)).toBe('working');
  });

  it('puts needs you first, then failed, working, just finished and idle', () => {
    const party = { celebrating: true, seenErrors: new Set<string>() };
    expect(companionMood(companionFeed([finished(), working(), failed(), asking()]), party)).toBe(
      'alert',
    );
    expect(companionMood(companionFeed([finished(), working(), failed()]), party)).toBe('sad');
    expect(companionMood(companionFeed([finished(), working()]), party)).toBe('working');
    expect(companionMood(companionFeed([finished()]), calm)).toBe('happy');
    expect(companionMood(companionFeed([]), party)).toBe('happy');
    expect(companionMood(companionFeed([]), calm)).toBe('idle');
  });

  it('stays calm about many chats at once and still shows the most urgent state', () => {
    const chats = [
      ...Array.from({ length: 5 }, (_, index) => working(`Run ${index}`)),
      asking('One'),
      asking('Two'),
      failed(),
    ];
    const feed = companionFeed(chats);
    expect(companionMood(feed, calm)).toBe('alert');
    expect(statusLabel(feed)).toBe('Status: 2 need you, 5 running, 1 failed');
  });

  it('is sad about a failure until it has been seen', () => {
    const broken = failed();
    const feed = companionFeed([working(), broken]);
    expect(companionMood(feed, calm)).toBe('sad');
    const seen = new Set([errorKey(broken)]);
    expect(companionMood(feed, { celebrating: false, seenErrors: seen })).toBe('working');
  });

  it('is sad again when the same chat fails in a new run', () => {
    const broken = failed();
    const seen = new Set([errorKey(broken)]);
    const again = { ...broken, latestRun: run('failed') };
    expect(companionMood(companionFeed([again]), { celebrating: false, seenErrors: seen })).toBe(
      'sad',
    );
  });
});

describe('status text', () => {
  it('reads all quiet when nothing is happening', () => {
    expect(statusLabel(companionFeed([]))).toBe('Status: all quiet');
  });

  it('summarises by urgency: needs you, running, failed, finished', () => {
    const feed = companionFeed([working(), working(), asking(), failed(), finished()]);
    expect(statusText(feed)).toBe('1 needs you, 2 running, 1 failed, 1 finished');
  });

  it('caps the running dots at five', () => {
    expect(runningDots(0)).toBe(0);
    expect(runningDots(5)).toBe(5);
    expect(runningDots(6)).toBe('5+');
  });
});

describe('finishedRunIds', () => {
  it('reports runs that went from running to succeeded', () => {
    const live = working();
    const queued = chat({ latestRun: run('queued') });
    const before = runStatuses([live, queued]);
    const done = { ...live, latestRun: { ...live.latestRun!, status: 'succeeded' as const } };
    expect(finishedRunIds(before, [done, queued])).toEqual([live.latestRun!.id]);
  });

  it('ignores runs that were already finished or never seen running', () => {
    const old = finished();
    expect(finishedRunIds(runStatuses([old]), [old])).toEqual([]);
    expect(finishedRunIds(new Map(), [old])).toEqual([]);
  });

  it('does not celebrate a failure', () => {
    const live = working();
    const broke = { ...live, latestRun: { ...live.latestRun!, status: 'failed' as const } };
    expect(finishedRunIds(runStatuses([live]), [broke])).toEqual([]);
  });
});

describe('nearestCorner', () => {
  it('snaps to the closest quarter of the viewport', () => {
    expect(nearestCorner(10, 10, 1000, 800)).toBe('top-left');
    expect(nearestCorner(900, 50, 1000, 800)).toBe('top-right');
    expect(nearestCorner(100, 700, 1000, 800)).toBe('bottom-left');
    expect(nearestCorner(600, 500, 1000, 800)).toBe('bottom-right');
  });
});
