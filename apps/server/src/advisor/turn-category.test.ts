import { describe, expect, it } from 'vitest';
import type { JevIntake } from '@spark-outpost/contracts';
import type { JevOutcome } from './advice-body.ts';
import { turnCategory } from './intake-recorder.ts';

function answered(intent: JevIntake['intent'], confidence: number): JevOutcome {
  return {
    status: 'answered',
    model: 'jev-1',
    asked: { state: {}, questions: {} },
    response: { model: 'jev-1', answers: {} },
    latencyMs: 5,
    usage: {
      inputTokens: 1,
      outputTokens: 0,
      tokenSource: 'reported',
      costUsd: 0,
      costSource: 'estimated',
    },
    intake: {
      intent,
      complexity: 1,
      risk: 'edits',
      injection: null,
      depth: 'execute',
      provider: 'claude',
      model: null,
      modelLabel: null,
      effort: null,
      confidence: 0.9,
      routeConfidence: null,
      confidences: { intent: confidence },
    },
  };
}

describe('turn category', () => {
  it('keeps a confident category and drops a guess below 0.5', () => {
    expect(turnCategory(answered('debugging', 0.72))).toBe('debugging');
    expect(turnCategory(answered('debugging', 0.5))).toBe('debugging');
    expect(turnCategory(answered('debugging', 0.49))).toBeNull();
  });

  it('shows nothing when Jev did not answer', () => {
    expect(turnCategory({ status: 'not_connected' })).toBeNull();
    expect(
      turnCategory({ status: 'failed', error: 'x', model: 'jev-1', asked: null, latencyMs: null }),
    ).toBeNull();
  });
});
