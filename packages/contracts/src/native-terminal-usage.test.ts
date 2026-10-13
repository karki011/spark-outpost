import { describe, expect, it } from 'vitest';
import {
  reportedTotalNote,
  turnCostOrigin,
  usageOriginLabel,
  type NativeTerminalReported,
} from './native-terminal-usage.ts';

const reported: NativeTerminalReported = {
  costUsd: 0.4,
  cliSessions: 1,
  models: [],
  updatedAt: '2026-10-12T00:00:00.000Z',
};

describe('terminal usage labels', () => {
  it('says where each number came from', () => {
    expect(usageOriginLabel('estimated')).toBe('estimated from tokens');
    expect(usageOriginLabel('reported', 'claude')).toBe('reported by Claude Code');
    expect(usageOriginLabel('reported', 'codex')).toBe('reported by Codex');
    expect(usageOriginLabel('reported')).toBe('reported by the CLI');
    expect(usageOriginLabel('unknown', 'claude')).toBe('unknown');
  });

  it('calls a turn without a cost unknown, never zero, and a priced turn an estimate', () => {
    expect(turnCostOrigin({ costUsd: null, costSource: null })).toBe('unknown');
    expect(turnCostOrigin({ costUsd: null, costSource: 'estimated' })).toBe('unknown');
    expect(turnCostOrigin({ costUsd: 0, costSource: 'estimated' })).toBe('estimated');
    expect(turnCostOrigin({ costUsd: 0.2, costSource: null })).toBe('estimated');
    expect(turnCostOrigin({ costUsd: 0.2, costSource: 'reported' })).toBe('reported');
  });

  it('explains a missing session total by the agent', () => {
    expect(reportedTotalNote('claude', reported)).toBe('reported by Claude Code');
    expect(reportedTotalNote('claude', null)).toBe(
      'unknown until Claude Code exits and writes its own total',
    );
    expect(reportedTotalNote('codex', null)).toBe('unknown: Codex reports no cost');
    expect(reportedTotalNote(null, null)).toBe('unknown');
  });
});
