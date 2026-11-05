import { describe, expect, it } from 'vitest';
import { toCrewMember, toDecision, type DecisionRow, type MemberRow } from './view.ts';

const member = (route: unknown): MemberRow => ({
  id: '00000000-0000-4000-8000-000000000001',
  role: 'builder',
  step_index: 0,
  attempt: 1,
  agent_label: null,
  provider: 'claude',
  model: 'claude-sonnet-5',
  effort: null,
  mode: 'do',
  route: route as MemberRow['route'],
  status: 'succeeded',
  error: null,
  tokens: null,
  cost_usd: null,
  cost_source: null,
  duration_ms: null,
  tool_call_count: null,
  started_at: null,
  finished_at: null,
});

const decision = (purpose: DecisionRow['purpose'], body: unknown): DecisionRow => ({
  id: '00000000-0000-4000-8000-000000000002',
  purpose,
  child_run_id: null,
  role: 'builder',
  step_index: null,
  jev_status: 'not_asked',
  jev_input_tokens: null,
  jev_cost_usd: null,
  body: body as DecisionRow['body'],
  created_at: new Date('2026-09-01T00:00:00Z'),
});

describe('crew members from stored routes', () => {
  it('keeps well-formed route fields', () => {
    const crew = toCrewMember(
      member({
        name: 'Bolt',
        routedBy: 'jev',
        modelLabel: 'Sonnet 5',
        autoWouldUse: { provider: 'codex', model: 'x', modelLabel: null, effort: null },
      }),
    );
    expect(crew).toMatchObject({
      name: 'Bolt',
      routedBy: 'jev',
      modelLabel: 'Sonnet 5',
      autoWouldUse: { provider: 'codex', model: 'x' },
    });
  });

  it('ignores malformed route fields', () => {
    const crew = toCrewMember(
      member({ name: 5, routedBy: 'magic', autoWouldUse: 'codex', quality: 'good', verdict: 1 }),
    );
    expect(crew).toMatchObject({
      name: 'Builder',
      routedBy: 'rules',
      autoWouldUse: null,
      quality: null,
      verdict: null,
    });
    expect(toCrewMember(member('garbage')).routedBy).toBe('rules');
  });
});

describe('decisions from stored bodies', () => {
  it('keeps safe values when a body is malformed', () => {
    const route = toDecision(
      decision('route', {
        summary: 7,
        applied: 'someone',
        gate: 'x',
        latencyMs: 'slow',
        answer: 3,
      }),
    );
    expect(route).toMatchObject({
      summary: '',
      applied: 'rules',
      gate: null,
      jevError: null,
      latencyMs: null,
      answer: {},
    });
    const intake = toDecision(decision('intake', { purpose: 'intake' }));
    expect(intake).toMatchObject({ summary: '', applied: 'rules', answer: {} });
  });
});
