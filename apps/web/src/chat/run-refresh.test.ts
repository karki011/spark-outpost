import { describe, expect, it } from 'vitest';
import {
  EventType,
  MEMBER_MESSAGE_ACTIVITY,
  OUTPOST_DRAFT_ACTIVITY,
  type RunEvent,
} from '@spark-outpost/contracts';
import { refreshesChat } from './run-refresh.ts';

function activity(activityType: string): RunEvent {
  return {
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: 'm1',
    activityType,
    content: {},
  } as RunEvent;
}

describe('refreshesChat', () => {
  it('refreshes the chat when a turn proposes an outpost draft, so its line shows at once', () => {
    expect(refreshesChat(activity(OUTPOST_DRAFT_ACTIVITY))).toBe(true);
  });

  it('refreshes for a crew message and not for an activity it does not know', () => {
    expect(refreshesChat(activity(MEMBER_MESSAGE_ACTIVITY))).toBe(true);
    expect(refreshesChat(activity('something_else'))).toBe(false);
  });

  it('does not refresh for streamed text', () => {
    const text = { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'hi' } as RunEvent;
    expect(refreshesChat(text)).toBe(false);
  });
});
