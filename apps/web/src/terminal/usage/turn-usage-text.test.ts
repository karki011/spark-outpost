import { describe, expect, it } from 'vitest';
import type { NativeTerminalTurn } from '@spark-outpost/contracts';
import { estimateTotal, turnUsageText } from './turn-usage-text.ts';

const turn = (extra: Partial<NativeTerminalTurn>): NativeTerminalTurn => ({
  runId: '00000000-0000-4000-8000-000000000001',
  startedAt: '2026-10-12T10:00:00.000Z',
  status: 'succeeded',
  model: 'claude-opus-5-5',
  tokens: null,
  costUsd: null,
  costSource: null,
  durationMs: null,
  steps: [],
  ...extra,
});
const tokens = {
  input: 6,
  output: 1039,
  total: 4345,
  cachedRead: 3000,
  cachedWrite: 300,
  thought: 0,
};

describe('terminal turn usage text', () => {
  it('says unknown, not zero, when a turn has no data', () => {
    expect(turnUsageText(turn({}), 'claude')).toEqual({
      tokens: 'Tokens unknown',
      detail: null,
      cost: 'Cost unknown',
      origin: '',
    });
  });

  it('marks an estimated cost and says where it came from', () => {
    expect(
      turnUsageText(turn({ tokens, costUsd: 0.023804, costSource: 'estimated' }), 'claude'),
    ).toEqual({
      tokens: '4.3K tokens',
      detail: 'in 6 · out 1K · cache read 3K · cache write 300',
      cost: '~$0.02',
      origin: 'estimated from tokens',
    });
  });

  it('keeps the tokens when the model has no price', () => {
    expect(turnUsageText(turn({ tokens }), 'codex')).toMatchObject({
      tokens: '4.3K tokens',
      cost: 'Cost unknown',
    });
  });

  it('adds up only the turns that have an estimate', () => {
    expect(estimateTotal([turn({}), turn({})])).toBeNull();
    expect(estimateTotal([turn({ costUsd: 0.1 }), turn({}), turn({ costUsd: 0.2 })])).toBe(0.3);
  });
});
