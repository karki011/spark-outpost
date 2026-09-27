import { describe, expect, it } from 'vitest';
import { ORCHESTRATION_TOOL_CALL_LIMIT } from '@spark-outpost/contracts';
import {
  COMMAND_READER_TOOL_CALL_LIMIT,
  baseLimits,
  fitToolLimit,
  toolCallLimitFor,
} from './session.ts';
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
