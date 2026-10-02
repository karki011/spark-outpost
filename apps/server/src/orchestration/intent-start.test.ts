import { describe, expect, it } from 'vitest';
import type { JevIntake } from '@spark-outpost/contracts';
import { decideIntake, turnIntent, type IntakeFacts } from './intake.ts';
import { intentByRule } from './intent-rules.ts';

const jev = (extra: Partial<JevIntake> = {}): JevIntake => ({
  intent: 'feature',
  complexity: null,
  risk: 'edits',
  injection: null,
  depth: 'execute',
  provider: 'claude',
  model: null,
  modelLabel: null,
  effort: null,
  question: 0.02,
  plan: 0.02,
  confidence: 0.9,
  routeConfidence: null,
  confidences: { intent: 0.9 },
  ...extra,
});

const facts = (extra: Partial<IntakeFacts> = {}): IntakeFacts => ({
  request: 'Add a CSV export to the reports page',
  mode: 'do',
  level: 'balanced',
  firstMessage: true,
  namedFiles: 1,
  currentTask: null,
  ...extra,
});

describe('intent to start', () => {
  it('sends question and research to the Reader only', () => {
    const research = decideIntake(jev({ intent: 'research', question: 0.92 }), facts());
    expect(research).toMatchObject({ intent: 'research', start: 'answer' });
    const question = decideIntake(jev({ intent: 'question', question: 0.95 }), facts());
    expect(question).toMatchObject({ intent: 'question', start: 'answer' });
  });

  it('plans first for plan and design', () => {
    const planned = decideIntake(jev({ intent: 'plan', plan: 0.9 }), facts());
    expect(planned).toMatchObject({ intent: 'plan', start: 'plan_first' });
    expect(planned.calls.plan).toMatchObject({ jev: 0.9, source: 'jev', value: true });
  });

  it('builds everything else, planning first when it is complex or destructive', () => {
    expect(decideIntake(jev({ intent: 'bug_fix' }), facts())).toMatchObject({
      intent: 'bug_fix',
      start: 'build',
    });
    const complex = jev({ ratings: { complexity: { value: 4, confidence: 0.8 } } });
    expect(decideIntake(complex, facts()).start).toBe('plan_first');
    const unsure = jev({ ratings: { complexity: { value: 5, confidence: 0.2 } } });
    expect(decideIntake(unsure, facts()).start).toBe('build');
    const destructive = decideIntake(jev({ destructive: 0.95 }), facts());
    expect(destructive.start).toBe('plan_first');
  });

  it('asks first when the request is vague, whatever the intent', () => {
    expect(decideIntake(jev({ intent: 'feature', vague: 0.95 }), facts()).start).toBe('ask_agent');
  });

  it('does not plan again once a plan is agreed', () => {
    const planned = jev({ intent: 'plan', plan: 0.9 });
    expect(decideIntake(planned, facts({ hasAgreedPlan: true })).start).toBe('build');
  });
});

describe('rules fallback', () => {
  it('produces an intent and a start without Jev', () => {
    expect(
      decideIntake(null, facts({ request: 'Investigate why the divider jumps' })),
    ).toMatchObject({ intent: 'research', start: 'answer' });
    expect(
      decideIntake(null, facts({ request: 'Design the export, then build it' })),
    ).toMatchObject({ intent: 'plan', start: 'plan_first' });
    expect(decideIntake(null, facts({ request: 'Fix the crash in parseDate' }))).toMatchObject({
      intent: 'bug_fix',
      start: 'build',
    });
  });

  it('uses the rules intent when Jev is unsure of its category', () => {
    const unsure = jev({ intent: 'docs', confidences: { intent: 0.3 } });
    expect(turnIntent(unsure, { request: 'Fix the crash', mode: 'do' })).toBe('bug_fix');
    expect(turnIntent(jev({ intent: 'docs' }), { request: 'Fix the crash', mode: 'do' })).toBe(
      'docs',
    );
  });

  it('classifies each intent by its wording', () => {
    const cases: [string, string][] = [
      ['How does the retry logic work?', 'question'],
      ['Find where the upload size is checked', 'research'],
      ['Plan adding CSV export. Plan only for now.', 'plan'],
      ['Fix the broken date divider', 'bug_fix'],
      ['Add dark mode to settings', 'feature'],
      ['Refactor the parser into two modules', 'refactor'],
      ['Update the README install steps', 'docs'],
      ['Add tests for parseDate', 'tests'],
      ['Upgrade the eslint dependencies', 'config'],
      ['Review my changes to the parser', 'review'],
    ];
    for (const [request, intent] of cases)
      expect(intentByRule(request, 'do'), request).toBe(intent);
    expect(intentByRule('Add dark mode', 'ask')).toBe('question');
  });
});
