import { describe, expect, it } from 'vitest';
import {
  CHECKPOINT_OPTION,
  MAX_REPAIR_RETRIES,
  type Depth,
  type InvolvementLevel,
  type Risk,
  type TransitionNext,
  type TransitionStatus,
} from '@spark-outpost/contracts';
import { agentExcerpt, needsInputCard, waitingLine } from './checkpoint.ts';
import { chooseTransition } from './transition-choice.ts';
import {
  initialFlow,
  nextStep,
  type AgentOutcome,
  type FlowEvent,
  type FlowState,
} from './transitions.ts';

function after(
  events: FlowEvent[],
  depth: Depth = 'execute',
  risk: Risk = 'edits',
  level: InvolvementLevel = 'balanced',
): FlowState {
  let state = initialFlow(depth, risk, level);
  for (const event of events) state = nextStep(state, event).state;
  return state;
}

const start: FlowEvent = { type: 'start', intake: 'act' };
const built: FlowEvent = { type: 'agent_done', role: 'builder', outcome: 'succeeded' };
const failed: FlowEvent = { type: 'agent_done', role: 'builder', outcome: 'failed' };
const jev = (status: TransitionStatus, next: TransitionNext, confidence: number) => ({
  status,
  next,
  confidence,
});

function decide(
  state: FlowState,
  pick: ReturnType<typeof jev>,
  outcome: AgentOutcome = 'succeeded',
) {
  const { event } = chooseTransition(state, outcome, pick);
  return { event, result: nextStep(state, event) };
}

describe('gating what Jev says the agent needs', () => {
  it('falls back to the rules when Jev says needs you below the act threshold', () => {
    for (const level of ['balanced', 'hands-off', 'full-auto'] as const) {
      const state = after([start, built], 'execute', 'edits', level);
      const { event, result } = decide(state, jev('needs_you', 'finish', 0.64));
      expect(event).toMatchObject({
        status: 'done',
        next: 'finish',
        source: 'rules',
        confidence: null,
      });
      expect(result.action).toEqual({ type: 'wrap_up' });
    }
  });

  it('moves on to the next step when the low-confidence answer falls back mid-plan', () => {
    const state = after(
      [start, { type: 'agent_done', role: 'architect', outcome: 'succeeded', steps: ['a', 'b'] }],
      'plan_execute',
      'edits',
      'hands-off',
    );
    const single = nextStep({ ...state, last: { ...state.last!, carry: undefined } }, built).state;
    const { event, result } = decide(single, jev('needs_you', 'finish', 0.64));
    expect(event).toMatchObject({ status: 'done', next: 'next_step', source: 'rules' });
    expect(result.action).toMatchObject({ type: 'spawn', role: 'builder', stepIndex: 1 });
  });

  it('asks for your input, not a retry, when Jev is sure the agent needs you', () => {
    const state = after([start, built]);
    const { event, result } = decide(state, jev('needs_you', 'finish', 0.95));
    expect(event).toMatchObject({ source: 'jev', confidence: 0.95, status: 'needs_you' });
    expect(result.action).toMatchObject({ type: 'ask', kind: 'needs_input', blocked: false });
    expect(result.state.fallback).toEqual({ status: 'done', next: 'finish' });
  });

  it('asks for your input when Jev is sure the agent is blocked', () => {
    const { result } = decide(after([start, built]), jev('blocked', 'finish', 0.92));
    expect(result.action).toMatchObject({ type: 'ask', kind: 'needs_input', blocked: true });
  });

  it('uses the lower act threshold for read-only work', () => {
    const readOnly = after([start, built], 'execute', 'read-only');
    expect(decide(readOnly, jev('blocked', 'finish', 0.8)).result.action).toMatchObject({
      kind: 'needs_input',
    });
    const edits = after([start, built], 'execute', 'edits');
    expect(decide(edits, jev('blocked', 'finish', 0.8)).result.action).toEqual({
      type: 'wrap_up',
    });
  });

  it('sends your answer back to the same Builder as its next instruction', () => {
    const waiting = decide(after([start, built]), jev('needs_you', 'finish', 0.95)).result.state;
    const answered = nextStep(waiting, {
      type: 'answered',
      kind: 'needs_input',
      optionId: CHECKPOINT_OPTION.answer,
      note: 'Use the staging bucket',
    });
    expect(answered.action).toMatchObject({
      type: 'spawn',
      role: 'builder',
      stepIndex: 0,
      escalate: false,
      reason: 'answer',
      note: 'Use the staging bucket',
    });
    expect(answered.state.retries).toBe(0);
  });

  it('lets the rules continue, or stops, from the needs-input card', () => {
    const waiting = decide(after([start, built]), jev('needs_you', 'finish', 0.95)).result.state;
    const answer = (optionId: string): FlowEvent => ({
      type: 'answered',
      kind: 'needs_input',
      optionId,
      note: null,
    });
    expect(nextStep(waiting, answer(CHECKPOINT_OPTION.clarifyRules)).action).toEqual({
      type: 'wrap_up',
    });
    expect(nextStep(waiting, answer(CHECKPOINT_OPTION.answer)).action).toEqual({
      type: 'wrap_up',
    });
    expect(nextStep(waiting, answer(CHECKPOINT_OPTION.stop)).action).toMatchObject({
      type: 'finish',
      status: 'cancelled',
    });
  });

  it('keeps the retry card when the rules stop after the last failed retry', () => {
    const state = { ...after([start, failed]), retries: MAX_REPAIR_RETRIES };
    const { event, result } = decide(state, jev('needs_you', 'finish', 0.3), 'failed');
    expect(event).toMatchObject({ status: 'needs_you', source: 'rules' });
    expect(result.action).toMatchObject({
      kind: 'retry',
      reason: `Stopped after ${MAX_REPAIR_RETRIES} retries.`,
    });
  });
});

describe('gating where Jev says to go next', () => {
  it('applies a confident answer as Jev', () => {
    const { event } = decide(after([start, built]), jev('done', 'review', 0.95));
    expect(event).toMatchObject({ source: 'jev', next: 'review', confidence: 0.95 });
  });

  it('turns a retry or review below the act threshold into a confirmation where you confirm', () => {
    for (const next of ['retry_up', 'review'] as const) {
      const { event, result } = decide(after([start, built]), jev('done', next, 0.7));
      expect(event).toMatchObject({ source: 'jev', next });
      expect(result.action).toMatchObject({ type: 'ask', kind: 'retry', suggestion: next });
    }
  });

  it('falls back to the rules below the act threshold where nobody confirms', () => {
    for (const level of ['hands-off', 'full-auto'] as const) {
      for (const next of ['retry_up', 'review'] as const) {
        const state = after([start, built], 'execute', 'edits', level);
        const { event, result } = decide(state, jev('done', next, 0.7));
        expect(event).toMatchObject({ source: 'rules', next: 'finish', confidence: null });
        expect(result.action).toEqual({ type: 'wrap_up' });
      }
    }
  });

  it('ignores more work or a plain next step below the act threshold', () => {
    const state = after([start, built]);
    expect(decide(state, jev('needs_more_work', 'finish', 0.7)).event).toMatchObject({
      status: 'done',
      source: 'rules',
    });
    expect(decide(state, jev('done', 'retry_up', 0.4)).event.source).toBe('rules');
  });
});

describe('the needs-input card', () => {
  it('says who is waiting and why in plain sentences', () => {
    expect(waitingLine('Bolt', true, 'The API key is missing.')).toBe(
      "Bolt says it's blocked: The API key is missing.",
    );
    expect(waitingLine('Bolt', false, 'Which bucket should I use?')).toBe(
      'Bolt is waiting for your input: Which bucket should I use?',
    );
    expect(waitingLine('Bolt', false, '')).toBe('Bolt is waiting for your input.');
  });

  it("quotes the agent's last question, or its last line", () => {
    expect(agentExcerpt('Done the first part.\nWhich bucket should I use?\nThanks.')).toBe(
      'Which bucket should I use?',
    );
    expect(agentExcerpt('Changed a.ts.\n\nI stopped here.')).toBe('I stopped here.');
    expect(agentExcerpt('x'.repeat(400))).toHaveLength(300);
  });

  it('offers an answer, the rules, or stop', () => {
    const card = needsInputCard('Bolt', false, 'Which bucket should I use?');
    expect(card.title).toBe('Bolt needs your input');
    expect(card.payload).toMatchObject({
      kind: 'clarify',
      agent: 'Bolt',
      reason: 'Bolt is waiting for your input: Which bucket should I use?',
    });
    expect(card.options.map((option) => option.optionId)).toEqual([
      CHECKPOINT_OPTION.answer,
      CHECKPOINT_OPTION.clarifyRules,
      CHECKPOINT_OPTION.stop,
    ]);
  });
});
