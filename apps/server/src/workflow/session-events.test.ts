import { describe, expect, it } from 'vitest';
import { CONTINUED_SESSION, FIRST_SESSION, modelChange, sessionEvent } from './session-events.ts';

const NOW = new Date('2026-10-06T12:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

const facts = {
  provider: 'claude',
  agentKey: 'chat:do',
  model: 'sonnet',
  previous: null,
  seedChars: 8_000,
  handoff: false,
  now: NOW,
};
const previous = {
  model: 'sonnet',
  agentMode: 'acceptEdits',
  contextUsed: 200_000,
  lastUsedAt: minutesAgo(2),
  closeReason: null,
};

describe('sessionEvent', () => {
  it('records the first session of a chat as an open with what it was seeded with', () => {
    const event = sessionEvent(facts, { sessionId: 's1', continued: false, freshReason: null });
    expect(event).toMatchObject({
      event: 'open',
      reason: FIRST_SESSION,
      carriedTokens: 2_000,
      sessionId: 's1',
      kept: true,
    });
    expect(event.cacheWriteUsd).toBeGreaterThan(0);
  });

  it('caps the seed at what a fresh session is sent', () => {
    const event = sessionEvent(
      { ...facts, seedChars: 400_000 },
      { sessionId: 's1', continued: false, freshReason: null },
    );
    expect(event.carriedTokens).toBe(9_000);
  });

  it('records a resume inside the cache window as costing no cache write', () => {
    const event = sessionEvent(
      { ...facts, previous },
      { sessionId: 's1', continued: true, freshReason: null },
    );
    expect(event).toMatchObject({
      event: 'resume',
      reason: CONTINUED_SESSION,
      carriedTokens: 200_000,
      cacheWriteUsd: 0,
    });
  });

  it('prices a resume after the cache window as a full cache write', () => {
    const cold = { ...previous, lastUsedAt: minutesAgo(30) };
    const event = sessionEvent(
      { ...facts, previous: cold },
      { sessionId: 's1', continued: true, freshReason: null },
    );
    expect(event.cacheWriteUsd).toBeGreaterThan(0.1);
  });

  it('records a replacement with the reason the agent or Spark gave', () => {
    const closed = { ...previous, closeReason: 'idle' };
    expect(
      sessionEvent(
        { ...facts, previous: closed },
        { sessionId: 's2', continued: false, freshReason: null },
      ),
    ).toMatchObject({ event: 'replace', reason: 'idle' });
    expect(
      sessionEvent(
        { ...facts, previous: closed, handoff: true },
        { sessionId: 's2', continued: false, freshReason: "couldn't resume" },
      ),
    ).toMatchObject({ event: 'replace', reason: "couldn't resume", handoff: true });
  });

  it('leaves the cost empty for a model without a price', () => {
    const event = sessionEvent(
      { ...facts, model: 'mystery-model' },
      { sessionId: 's1', continued: false, freshReason: null },
    );
    expect(event.cacheWriteUsd).toBeNull();
  });
});

describe('modelChange', () => {
  it('is silent while the model stays the same', () => {
    expect(modelChange({ ...facts, previous }, 's1', { model: 'sonnet', mode: 'plan' })).toBeNull();
    expect(modelChange(facts, 's1', { model: 'opus[1m]', mode: null })).toBeNull();
  });

  it('prices a switch on the same session with the re-read estimate', () => {
    const event = modelChange({ ...facts, previous }, 's1', { model: 'opus[1m]', mode: 'default' });
    expect(event).toMatchObject({
      event: 'model_change',
      fromModel: 'sonnet',
      model: 'opus[1m]',
      fromMode: 'acceptEdits',
      mode: 'default',
      carriedTokens: 200_000,
    });
    expect(event?.cacheWriteUsd).toBeGreaterThan(0);
  });
});
