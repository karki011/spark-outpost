import { describe, expect, it } from 'vitest';
import { declineInConversation, nativePlan } from './permissions.ts';

const toolCall = { toolCallId: 't', title: 'Write notes.txt' };

describe('conversation permission policy', () => {
  it('picks the reject-once option and explains why', () => {
    const decision = declineInConversation({
      sessionId: 's',
      toolCall,
      options: [
        { optionId: 'ok', name: 'Yes', kind: 'allow_once' },
        { optionId: 'always', name: 'Always', kind: 'allow_always' },
        { optionId: 'no', name: 'No', kind: 'reject_once' },
      ],
    });
    expect(decision.response).toEqual({ outcome: { outcome: 'selected', optionId: 'no' } });
    expect(decision.note).toBe('Declined: Write notes.txt (this chat has no project folder)');
  });

  it('points to Do mode when a project chat is asked to change something', () => {
    const decision = declineInConversation(
      { sessionId: 's', toolCall, options: [{ optionId: 'no', name: 'No', kind: 'reject_once' }] },
      true,
    );
    expect(decision.note).toBe(
      "Declined: Write notes.txt (Ask mode doesn't change files — use Make the change)",
    );
  });

  it('cancels when the agent offers no way to reject', () => {
    const decision = declineInConversation({
      sessionId: 's',
      toolCall,
      options: [{ optionId: 'ok', name: 'Yes', kind: 'allow_once' }],
    });
    expect(decision.response).toEqual({ outcome: { outcome: 'cancelled' } });
  });
});

describe('a native plan offered in Ask (B5)', () => {
  const planRequest = (
    options: { optionId: string; name: string; kind: 'allow_once' | 'reject_once' }[],
  ) => ({
    sessionId: 's',
    toolCall: {
      toolCallId: 'plan-review:1',
      title: 'Implement this plan?',
      kind: 'switch_mode' as const,
      rawInput: { plan: '1. Add a CLI\n2. Add tests' },
    },
    options,
  });

  it("captures Claude's ExitPlanMode and Codex's plan review with their source", () => {
    const claude = planRequest([{ optionId: 'reject', name: 'No', kind: 'reject_once' }]);
    expect(nativePlan(claude, 'claude')).toEqual([
      {
        kind: 'plan_proposed',
        plan: '1. Add a CLI\n2. Add tests',
        toolCallId: 'plan-review:1',
        source: 'claude_plan_mode',
      },
    ]);
    const codex = planRequest([{ optionId: 'revise_plan', name: 'No', kind: 'reject_once' }]);
    expect(nativePlan(codex, 'codex')[0]).toMatchObject({ source: 'codex' });
    expect(declineInConversation(codex, true).response).toEqual({
      outcome: { outcome: 'selected', optionId: 'revise_plan' },
    });
  });

  it('ignores other permission requests', () => {
    expect(nativePlan({ sessionId: 's', toolCall, options: [] }, 'claude')).toEqual([]);
  });
});
