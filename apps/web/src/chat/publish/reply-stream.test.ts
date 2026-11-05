import { describe, expect, it } from 'vitest';
import { EventType, type RunEvent } from '@spark-outpost/contracts';
import { applyRunEvent, initialRunProjection } from '../run-projection.ts';

const WORK = 'Changed the parser. Tests pass.';
const PUBLISHED = 'Pushed and opened pull request #4.';

const twoPrompts: RunEvent[] = [
  { type: EventType.RUN_STARTED, runId: 'r', threadId: 't' },
  { type: EventType.TEXT_MESSAGE_START, messageId: 'work', role: 'assistant' },
  { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'work', delta: WORK },
  { type: EventType.TEXT_MESSAGE_END, messageId: 'work' },
  { type: EventType.TEXT_MESSAGE_START, messageId: 'publish', role: 'assistant' },
  { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'publish', delta: 'Pushed and opened ' },
  { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'publish', delta: 'pull request #4.' },
  { type: EventType.TEXT_MESSAGE_END, messageId: 'publish' },
];

function replay(events: readonly RunEvent[]) {
  return events.reduce(
    (state, event, index) => applyRunEvent(state, index + 1, event),
    initialRunProjection,
  );
}

describe('a run that streams a second reply', () => {
  it('keeps the work reply as the text and the publish reply apart', () => {
    const state = replay(twoPrompts);
    expect(state.text).toBe(WORK);
    expect(state.publishText).toBe(PUBLISHED);
  });

  it('still shows the whole work reply while the publish reply streams', () => {
    const state = replay(twoPrompts.slice(0, 6));
    expect(state.text).toBe(WORK);
    expect(state.publishText).toBe('Pushed and opened ');
  });

  it('separates a third reply from the second with a blank line', () => {
    const state = replay([
      ...twoPrompts,
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'again', delta: 'Not published.' },
    ]);
    expect(state.publishText).toBe(`${PUBLISHED}\n\nNot published.`);
  });

  it('notes how many commands had started when the work reply closed', () => {
    expect(replay(twoPrompts.slice(0, 3)).replyEnd).toBeNull();
    expect(replay(twoPrompts).replyEnd).toEqual({ commands: 0, terminals: 0, at: null });
  });

  it('keeps one reply whole when it is closed and a line is added after', () => {
    const state = replay([
      ...twoPrompts.slice(0, 4),
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'work', delta: '\n\nNo pull request.' },
    ]);
    expect(state.text).toBe(`${WORK}\n\nNo pull request.`);
    expect(state.publishText).toBe('');
  });
});
