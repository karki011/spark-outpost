import { describe, expect, it } from 'vitest';
import { assistantEventKindSchema } from '@spark-outpost/contracts';
import {
  ASSISTANT_AUDIT_METHOD,
  auditAssistantEvent,
  eventLine,
  sessionEventKind,
} from './assistant-events.ts';

describe('Ask Spark events', () => {
  it('names the session event from what was planned and what the agent did', () => {
    const resume = { sessionId: 's1' };
    expect(sessionEventKind(null, false)).toBe('session_started');
    expect(sessionEventKind({ resume }, true)).toBe('session_resumed');
    expect(sessionEventKind({ resume }, false)).toBe('session_reseeded');
    expect(sessionEventKind({ resume: null, handoff: 'summary' }, false)).toBe('session_reseeded');
  });

  it('writes one plain line for every kind, with its detail', () => {
    const lines = assistantEventKindSchema.options.map((kind) => eventLine(kind, null));
    expect(new Set(lines).size).toBe(assistantEventKindSchema.options.length);
    expect(eventLine('fact_added', 'the word pineapple')).toBe(
      'Key fact added: the word pineapple',
    );
  });

  it('audits each event under its own method', () => {
    const messages: unknown[] = [];
    const audit = { message: (_: string, message: unknown) => messages.push(message), stderr() {} };
    auditAssistantEvent(audit, {
      id: '00000000-0000-4000-8000-000000000001',
      runId: null,
      kind: 'history_cleared',
      line: 'Ask Spark history cleared',
      at: '2026-10-15T10:00:00.000Z',
    });
    expect(messages).toEqual([
      {
        method: `${ASSISTANT_AUDIT_METHOD}/history_cleared`,
        params: { line: 'Ask Spark history cleared', at: '2026-10-15T10:00:00.000Z' },
      },
    ]);
  });
});
