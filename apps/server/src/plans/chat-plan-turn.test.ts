import { describe, expect, it } from 'vitest';
import type { Db } from '../persistence/db.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { chatPlanInput, startsInPlanMode } from './chat-plan-turn.ts';

const input = (extra: Partial<RunInput> = {}): RunInput =>
  ({
    prompt: 'Add CSV export',
    userRequest: 'Add CSV export',
    provider: 'claude',
    mode: 'do',
    agentMode: 'auto',
    parentRunId: null,
    role: null,
    projectRoots: ['/repo'],
    settings: { method: 'cli', model: 'sonnet', modelLabel: null, effort: null, mode: 'auto' },
    ...extra,
  }) as RunInput;

const unusedDb = {
  query: () => Promise.reject(new Error('a turn that is not a plan turn writes nothing')),
} as unknown as Db;

describe('startsInPlanMode', () => {
  it('is true for /plan and for every message of a Plan-mode chat, in a project', () => {
    expect(startsInPlanMode(input({ userRequest: '/plan Add CSV export' }))).toBe(true);
    expect(startsInPlanMode(input({ agentMode: 'plan', mode: 'ask' }))).toBe(true);
    expect(
      startsInPlanMode(input({ agentMode: 'plan', mode: 'ask', userRequest: 'What is this?' })),
    ).toBe(true);
  });

  it('is false in any other mode, without a project, for a Spark and for a child run', () => {
    expect(startsInPlanMode(input())).toBe(false);
    expect(startsInPlanMode(input({ userRequest: '/plan x', projectRoots: [] }))).toBe(false);
    expect(startsInPlanMode(input({ userRequest: '/plan x', assistant: true }))).toBe(false);
    expect(startsInPlanMode(input({ userRequest: '/plan x', parentRunId: 'parent' }))).toBe(false);
  });
});

describe('chatPlanInput for a turn that is not a plan turn', () => {
  it('leaves the message as typed and never reads its wording to decide on planning', async () => {
    const planOnly = input({
      prompt: "Plan adding CSV export. Plan only for now: don't change any files.",
      userRequest: "Plan adding CSV export. Plan only for now: don't change any files.",
    });

    const turn = await chatPlanInput(unusedDb, planOnly);

    expect(turn).toEqual({ ...planOnly, planning: false });
    expect(turn.plansFirst).toBeUndefined();
  });
});
