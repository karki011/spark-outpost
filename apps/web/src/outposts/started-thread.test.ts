import { describe, expect, it } from 'vitest';
import type { OutpostStory, StoryTask } from '@spark-outpost/contracts';
import { startedThread } from './started-thread.ts';

const DRAFT = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const OTHER = '9b2e1c3a-5d4f-4e6a-8b7c-1d2e3f4a5b6c';
const FIRST_POST = '1f0e2d3c-4b5a-4968-8776-655443322110';
const SECOND_POST = '2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

function task(position: number, openingPostId: string | null): StoryTask {
  return {
    conversationId: crypto.randomUUID(),
    handle: `chat${position}`,
    title: `Chat ${position}`,
    position,
    dependsOn: null,
    dependsOnHandle: null,
    stacked: false,
    openingPostId,
    state: null,
    reason: null,
    branch: null,
    pullRequest: null,
    warnings: [],
  };
}

function story(draftId: string | null, tasks: StoryTask[]): OutpostStory {
  return { draftId, title: 'Usage', leadConversationId: null, leadHandle: 'lead', tasks };
}

describe('startedThread', () => {
  it('opens the first sub-chat of the started draft by its story order', () => {
    const stories = [
      story(OTHER, [task(0, crypto.randomUUID())]),
      story(DRAFT, [task(1, SECOND_POST), task(0, FIRST_POST)]),
    ];
    expect(startedThread(stories, DRAFT)).toBe(FIRST_POST);
  });

  it('skips a sub-chat whose first request was not posted', () => {
    expect(startedThread([story(DRAFT, [task(0, null), task(1, SECOND_POST)])], DRAFT)).toBe(
      SECOND_POST,
    );
  });

  it('opens nothing for an outpost made by hand or a draft with no posted request', () => {
    expect(startedThread([story(DRAFT, [task(0, FIRST_POST)])], undefined)).toBeNull();
    expect(startedThread([story(DRAFT, [task(0, null)])], DRAFT)).toBeNull();
    expect(startedThread([], DRAFT)).toBeNull();
  });
});
