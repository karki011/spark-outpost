import { describe, expect, it } from 'vitest';
import { ORCHESTRATION_TOOL_CALL_LIMIT } from '@spark-outpost/contracts';
import {
  COMMAND_READER_TOOL_CALL_LIMIT,
  baseLimits,
  fitToolLimit,
  fixRoundLimits,
  toolCallLimitFor,
} from './session.ts';
import { fixRoundExceeded } from './budget-check.ts';
import type { OrchestratorDeps, Session } from './session.ts';

function session(deps: OrchestratorDeps, provider: string, extended = 0) {
  const base = baseLimits(deps, provider);
  const limits = { ...base, toolCallLimit: base.toolCallLimit + extended };
  return { deps, baseLimits: base, limits } as Session;
}

describe('tool-call budget per provider', () => {
  it('gives Codex crews room for the commands they read files with', () => {
    expect(toolCallLimitFor('claude')).toBe(ORCHESTRATION_TOOL_CALL_LIMIT);
    expect(toolCallLimitFor('codex')).toBe(COMMAND_READER_TOOL_CALL_LIMIT);
  });

  it('keeps a configured limit for every provider', () => {
    const deps = { budget: { toolCallLimit: 7 } } as OrchestratorDeps;
    expect(baseLimits(deps, 'codex').toolCallLimit).toBe(7);
  });

  it("raises a Claude chat's budget when a Codex member joins the crew, once", () => {
    const s = session({} as OrchestratorDeps, 'claude', 40);
    fitToolLimit(s, 'claude');
    expect(s.limits.toolCallLimit).toBe(ORCHESTRATION_TOOL_CALL_LIMIT + 40);
    fitToolLimit(s, 'codex');
    fitToolLimit(s, 'codex');
    expect(s.baseLimits.toolCallLimit).toBe(COMMAND_READER_TOOL_CALL_LIMIT);
    expect(s.limits.toolCallLimit).toBe(COMMAND_READER_TOOL_CALL_LIMIT + 40);
  });

  it('leaves a configured limit alone when a Codex member joins', () => {
    const s = session({ budget: { toolCallLimit: 7 } } as OrchestratorDeps, 'claude');
    fitToolLimit(s, 'codex');
    expect(s.limits.toolCallLimit).toBe(7);
  });
});

describe('one Critic fix round has its own budget', () => {
  const deps = {} as OrchestratorDeps;

  it('gets a quarter of the run’s tool calls, at least 20, and 4 minutes', () => {
    expect(fixRoundLimits(session(deps, 'codex'))).toEqual({ toolCalls: 30, activeMs: 240_000 });
    expect(fixRoundLimits(session(deps, 'claude'))).toEqual({ toolCalls: 20, activeMs: 240_000 });
    const tight = { fixRound: { toolCalls: 3, activeMs: 500 } } as OrchestratorDeps;
    expect(fixRoundLimits(session(tight, 'claude'))).toEqual({ toolCalls: 3, activeMs: 500 });
  });

  it('runs out by tool calls or active time since the round started, only while a round runs', () => {
    const s = session(deps, 'codex');
    const usage = (toolCalls: number, activeMs: number) => ({ toolCalls, activeMs, costUsd: 0 });
    expect(fixRoundExceeded(s, usage(500, 10_000_000))).toBeNull();
    s.fixRound = { round: 1, toolCallsAt: 70, activeMsAt: 100_000, hit: null };
    expect(fixRoundExceeded(s, usage(99, 100_000))).toBeNull();
    expect(fixRoundExceeded(s, usage(100, 100_000))).toBe('tool_calls');
    expect(fixRoundExceeded(s, usage(80, 340_000))).toBe('time');
  });
});
