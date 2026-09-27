import { describe, expect, it } from 'vitest';
import {
  EXPLORE_RULE,
  PLAN_APPROVED,
  builderPrompt,
  criticFollowUp,
  criticPrompt,
  planApprovedFollowUp,
  type BuilderContext,
} from './context.ts';
import { WORK_ORDERS_LIMIT, workOrdersText, type WorkOrder } from './work-orders.ts';

const order: WorkOrder = {
  steps: [0],
  goal: 'Move formatDay into src/dates.ts',
  change: ['src/dates.ts'],
  read: ['src/turns.ts'],
  excerpts: [{ path: 'src/turns.ts', lines: '1-2', text: "import { formatDay } from './dates';" }],
  decisions: ['keep the signature'],
  acceptance: ['formatDay returns the local day'],
  checks: ['pnpm test'],
};

const base: BuilderContext = {
  request: 'Move date handling',
  plan: ['Update src/dates.ts\nFiles: src/dates.ts', 'Update src/turns.ts'],
  stepIndex: 0,
  architectNotes: { files: ['dates.ts'], text: 'src/dates.ts exports formatDay.' },
  earlierChanges: [],
  note: null,
  findings: [],
};

describe('the Builder prompt with a work order', () => {
  it('leads with the work order and the exploration rule, and drops the duplicate notes', () => {
    const prompt = builderPrompt({
      ...base,
      workOrder: workOrdersText([order]),
      checkCommands: ['pnpm test', 'pnpm lint'],
    });
    const sections = prompt.split('\n\n## ').map((part) => part.split('\n')[0]);
    expect(sections.slice(0, 3)).toEqual([
      'Role: Builder. Make the change for your step only, then reply with what you changed.',
      'Work order',
      'Request',
    ]);
    expect(prompt).toContain(`\n\n${EXPLORE_RULE}\n\n## Request`);
    expect(prompt).toContain('Acceptance contract:\n- formatDay returns the local day');
    expect(prompt).not.toContain('## Notes from the Architect');
    expect(prompt).toContain('## Checks the harness runs after you\n- `pnpm test`\n- `pnpm lint`');
  });

  it('keeps the old layout with the Architect’s notes when there is no work order', () => {
    const prompt = builderPrompt(base);
    expect(prompt.startsWith('Role: Builder.')).toBe(true);
    expect(prompt).not.toContain('## Work order');
    expect(prompt).not.toContain(EXPLORE_RULE);
    expect(prompt).toContain('## Notes from the Architect');
  });

  it('stays within its budget with the longest inputs', () => {
    const huge = {
      ...order,
      excerpts: [{ path: 'src/big.ts', lines: null, text: 'q'.repeat(50_000) }],
    };
    const prompt = builderPrompt({
      ...base,
      request: 'r'.repeat(20_000),
      carry: [0, 1],
      workOrder: workOrdersText([huge, { ...huge, steps: [1] }]),
      checkCommands: ['pnpm test'],
    });
    const request = 8_000;
    const plan = base.plan.join('\n').length * 3;
    expect(prompt.length).toBeLessThan(WORK_ORDERS_LIMIT + request + plan + 2_500);
  });
});

describe('the Critic gets the diff and the contract', () => {
  const review = {
    changes: [{ path: 'src/dates.ts', additions: 3, deletions: 1 }],
    patch: '+export function formatDay() {}',
    checks: ['- `pnpm test` passed'],
    contract: 'Step 1: Move formatDay into src/dates.ts\n- formatDay returns the local day',
  };

  it('replaces the plan with the acceptance contract', () => {
    const prompt = criticPrompt({ request: 'Move date handling', plan: base.plan, ...review });
    expect(prompt).toContain('## Acceptance contract\nStep 1: Move formatDay');
    expect(prompt).not.toContain('## Plan');
    expect(prompt).toContain('## Diff');
    expect(criticFollowUp(review)).toContain('## Acceptance contract');
  });

  it('keeps the plan when the Architect wrote no work orders', () => {
    const prompt = criticPrompt({ request: 'x', plan: base.plan, ...review, contract: null });
    expect(prompt).toContain('## Plan\n1. Update src/dates.ts');
    expect(prompt).not.toContain('## Acceptance contract');
  });
});

describe('the follow-up that turns the Architect into the Builder', () => {
  it('approves the plan, marks the steps and names the checks', () => {
    const text = planApprovedFollowUp({
      plan: base.plan,
      steps: [0, 1],
      checkCommands: ['pnpm test'],
      note: null,
    });
    expect(text.startsWith(PLAN_APPROVED)).toBe(true);
    expect(text).toContain('Step N done.');
    expect(text).toContain('1. Update src/dates.ts  <- your step');
    expect(text).toContain('2. Update src/turns.ts  <- your step');
    expect(text).toContain('## Checks the harness runs after you\n- `pnpm test`');
    expect(text).toContain('Extra files read:');
    expect(text.length).toBeLessThan(1_500);
  });
});
