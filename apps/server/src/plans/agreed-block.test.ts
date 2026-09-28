import { describe, expect, it } from 'vitest';
import type { PlanDocument } from '@spark-outpost/contracts';
import { AGREED_PLAN_LIMIT, agreedPlanBlock, outlinePlan } from './agreed-block.ts';

const BODY = [
  '# Add CSV export',
  '',
  'Goal: let people download their report as CSV.',
  '',
  '## Steps',
  '1. Add `src/export.ts` with a CSV writer',
  '- [x] Read the report data',
  '- [ ] Add a test for quoting commas',
  '',
  '```ts',
  '- not an item',
  '```',
  '## Decisions',
  '- Use the built-in writer, no new dependency',
].join('\n');

function plan(body: string, extra: Partial<PlanDocument> = {}): PlanDocument {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    conversationId: '00000000-0000-4000-8000-000000000002',
    taskId: null,
    version: 3,
    status: 'approved',
    source: 'claude_plan_mode',
    body,
    sourceRunId: null,
    sourceMessageId: null,
    approvedAt: '2026-09-28T10:00:00.000Z',
    approvedBy: 'user',
    approvedOption: 'exit-plan-default',
    approvedCommit: 'abc',
    createdAt: '2026-09-28T09:59:00.000Z',
    ...extra,
  };
}

describe('outlinePlan', () => {
  it('finds the goal, the open items and the decisions', () => {
    expect(outlinePlan(BODY)).toEqual({
      goal: 'let people download their report as CSV.',
      open: ['Add `src/export.ts` with a CSV writer', 'Add a test for quoting commas'],
      decisions: ['Use the built-in writer, no new dependency'],
    });
  });

  it('uses the title when there is no opening sentence', () => {
    expect(outlinePlan('# Plan: Fix login\n1. Trim input\n2. Test').goal).toBe('Fix login');
  });
});

describe('agreedPlanBlock', () => {
  it('writes a short block with the goal, open items and decisions', () => {
    expect(agreedPlanBlock(plan(BODY))).toBe(
      [
        '## Agreed plan',
        'The user approved this plan (v3, Claude plan mode, 2026-09-28). Follow it unless the request now asks for something else, and say so when you depart from it.',
        'Goal: let people download their report as CSV.',
        'Open items:',
        '- Add `src/export.ts` with a CSV writer',
        '- Add a test for quoting commas',
        'Key decisions:',
        '- Use the built-in writer, no new dependency',
      ].join('\n'),
    );
  });

  it('marks the plan as possibly out of date when files it names changed', () => {
    expect(agreedPlanBlock(plan(BODY), ['src/export.ts'])).toContain(
      'This plan may be out of date: src/export.ts changed since it was approved.',
    );
  });

  it('keeps a prose plan as text and caps long plans', () => {
    expect(agreedPlanBlock(plan('Just rename the flag.'))).toContain('Just rename the flag.');
    const long = Array.from({ length: 200 }, (_, index) => `- step ${index} ${'x'.repeat(40)}`);
    const block = agreedPlanBlock(plan(long.join('\n')));
    expect(block.length).toBeLessThanOrEqual(AGREED_PLAN_LIMIT + 40);
    expect(block).toContain('- … and 188 more');
  });
});
