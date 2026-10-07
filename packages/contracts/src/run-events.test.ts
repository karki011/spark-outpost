import { describe, expect, it } from 'vitest';
import { EventType, parseRunEvent, stepMark } from './run-events.ts';

const finished = { type: EventType.RUN_FINISHED, runId: 'r', threadId: 't' };

describe('parseRunEvent', () => {
  it('reads a finished run with and without token usage', () => {
    const usage = [{ provider: 'claude', model: 'sonnet', inputTokens: 5, outputTokens: 2 }];
    expect(parseRunEvent(finished)).toMatchObject(finished);
    expect(parseRunEvent({ ...finished, usage })).toMatchObject({ usage });
  });

  it('refuses a value that is not an event', () => {
    expect(parseRunEvent({ type: 'NOT_AN_EVENT' })).toBeNull();
  });
});

describe('stepMark', () => {
  it('reads the Spark mark from a step event and ignores anything malformed', () => {
    const step = { type: EventType.STEP_FINISHED, stepName: 'Reading' };
    const marked = parseRunEvent({
      ...step,
      metadata: { spark: { toolCallId: 'call-1', interrupted: true } },
    });
    expect(stepMark(marked!)).toEqual({ toolCallId: 'call-1', interrupted: true });
    expect(stepMark(parseRunEvent(step)!)).toEqual({});
    expect(stepMark({ metadata: { spark: { interrupted: 'yes' } } })).toEqual({});
  });
});
