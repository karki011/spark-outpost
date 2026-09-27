import { describe, expect, it } from 'vitest';
import {
  CONTRACT_LIMIT,
  WORK_ORDER_LIMIT,
  WORK_ORDERS_LIMIT,
  contractText,
  coversSteps,
  extraReadsFromReply,
  orderedFiles,
  ordersForSteps,
  workOrderText,
  workOrdersFromReply,
  workOrdersText,
} from './work-orders.ts';

const REPLY = [
  'Plan ready with 3 steps.',
  'Step 1 · Files: src/dates.ts · Depends on: none',
  '',
  '```work-order',
  'Steps: 1-2',
  'Goal: Move formatDay into src/dates.ts',
  'Change: src/dates.ts, `src/divider.tsx`',
  'Read: src/turns.ts',
  'Decisions:',
  '- keep the formatDay(date: Date): string signature',
  '- no new dependencies',
  'Acceptance:',
  '- the divider shows the local day after midnight',
  '* a test covers 23:59 and 00:01',
  'Checks: pnpm test; pnpm lint',
  'Excerpt: src/divider.tsx:10-12',
  'export function Divider({ at }: Props) {',
  '  return <hr aria-label={formatDay(at)} />;',
  '}',
  'Excerpt: `src/turns.ts` 4-5',
  "import { formatDay } from './dates';",
  '```',
  '',
  '````work order',
  'Goal: Update src/turns.ts',
  'Change: src/turns.ts',
  'Acceptance:',
  '- turns group by local day',
  'Excerpt: src/turns.ts:1-4',
  '```ts',
  'export const turns = [];',
  '```',
  '````',
].join('\n');

describe('work orders from the Architect', () => {
  it('parses each fenced block with its steps, files, decisions, contract, checks and excerpts', () => {
    const orders = workOrdersFromReply(REPLY, 3);
    expect(orders).toHaveLength(2);
    expect(orders[0]).toEqual({
      steps: [0, 1],
      goal: 'Move formatDay into src/dates.ts',
      change: ['src/dates.ts', 'src/divider.tsx'],
      read: ['src/turns.ts'],
      decisions: ['keep the formatDay(date: Date): string signature', 'no new dependencies'],
      acceptance: [
        'the divider shows the local day after midnight',
        'a test covers 23:59 and 00:01',
      ],
      checks: ['pnpm test', 'pnpm lint'],
      excerpts: [
        {
          path: 'src/divider.tsx',
          lines: '10-12',
          text: 'export function Divider({ at }: Props) {\n  return <hr aria-label={formatDay(at)} />;\n}',
        },
        { path: 'src/turns.ts', lines: '4-5', text: "import { formatDay } from './dates';" },
      ],
    });
  });

  it('places a block without a Steps line by its position and keeps a nested code fence', () => {
    const [, second] = workOrdersFromReply(REPLY, 3);
    expect(second?.steps).toEqual([1]);
    expect(second?.excerpts[0]).toEqual({
      path: 'src/turns.ts',
      lines: '1-4',
      text: 'export const turns = [];',
    });
  });

  it('falls back to nothing for the old reply format, empty blocks and steps outside the plan', () => {
    expect(
      workOrdersFromReply('Plan ready.\n\nNotes for Builders:\nsrc/a.ts exports a().', 3),
    ).toEqual([]);
    expect(workOrdersFromReply('```work-order\nNote: nothing here\n```', 3)).toEqual([]);
    expect(workOrdersFromReply('```work-order\nSteps: 9\nGoal: too far\n```', 3)).toEqual([]);
  });

  it('keeps an unterminated block instead of dropping the Architect’s work', () => {
    const orders = workOrdersFromReply('```work-order\nSteps: 2\nGoal: Add a test', 3);
    expect(orders).toMatchObject([{ steps: [1], goal: 'Add a test' }]);
  });

  it('finds the orders for a Builder span and whether every step has one', () => {
    const orders = workOrdersFromReply(REPLY, 3);
    expect(ordersForSteps(orders, [2])).toEqual([]);
    expect(ordersForSteps(orders, [1])).toHaveLength(2);
    expect(coversSteps(orders, [0, 1])).toBe(true);
    expect(coversSteps(orders, [0, 2])).toBe(false);
    expect(orderedFiles(orders)).toEqual(['src/dates.ts', 'src/divider.tsx', 'src/turns.ts']);
  });
});

describe('work order text and budgets', () => {
  const order = workOrdersFromReply(REPLY, 3)[0]!;

  it('renders the order with its contract first and the excerpts last', () => {
    expect(workOrderText(order)).toBe(
      [
        'Steps 1, 2: Move formatDay into src/dates.ts',
        'Change: src/dates.ts, src/divider.tsx',
        'Read only: src/turns.ts',
        'Decisions and constraints:',
        '- keep the formatDay(date: Date): string signature',
        '- no new dependencies',
        'Acceptance contract:',
        '- the divider shows the local day after midnight',
        '- a test covers 23:59 and 00:01',
        'Checks the Architect expects to pass: pnpm test, pnpm lint',
        'Excerpts the Architect already read:',
        'src/divider.tsx:10-12',
        '```',
        'export function Divider({ at }: Props) {',
        '  return <hr aria-label={formatDay(at)} />;',
        '}',
        '```',
        'src/turns.ts:4-5',
        '```',
        "import { formatDay } from './dates';",
        '```',
      ].join('\n'),
    );
  });

  it('caps one order at 6 KB by cutting excerpts, never the contract', () => {
    const big = {
      ...order,
      excerpts: Array.from({ length: 5 }, (_, index) => ({
        path: `src/big${index}.ts`,
        lines: '1-400',
        text: 'x'.repeat(3_000),
      })),
    };
    const text = workOrderText(big);
    expect(text.length).toBeLessThanOrEqual(WORK_ORDER_LIMIT);
    expect(text).toContain(
      'Acceptance contract:\n- the divider shows the local day after midnight',
    );
    expect(text).toContain('src/big0.ts:1-400');
    expect(text).toContain('[cut]');
    expect(text).toMatch(/\[\d more excerpts left out\]/);
  });

  it('shares the 12 KB budget between the orders a carrying Builder gets', () => {
    const big = {
      ...order,
      excerpts: [{ path: 'src/big.ts', lines: null, text: 'y'.repeat(20_000) }],
    };
    const text = workOrdersText([big, big, big, big]);
    expect(text.length).toBeLessThanOrEqual(WORK_ORDERS_LIMIT + 10);
    expect(text.match(/Acceptance contract:/g)).toHaveLength(4);
  });

  it('gives the Critic only the goals and acceptance criteria, capped', () => {
    const orders = workOrdersFromReply(REPLY, 3);
    expect(contractText(orders)).toBe(
      [
        'Steps 1, 2: Move formatDay into src/dates.ts',
        '- the divider shows the local day after midnight',
        '- a test covers 23:59 and 00:01',
        'Step 2: Update src/turns.ts',
        '- turns group by local day',
      ].join('\n'),
    );
    expect(contractText([])).toBeNull();
    const long = { ...order, acceptance: Array.from({ length: 12 }, () => 'z'.repeat(400)) };
    expect(contractText([long])!.length).toBeLessThanOrEqual(CONTRACT_LIMIT + 10);
  });

  it('reads the Builder’s extra-files line', () => {
    expect(extraReadsFromReply('Done.\nExtra files read: none')).toBe('none');
    expect(extraReadsFromReply('**Extra files read:** src/x.ts (types)')).toBe('src/x.ts (types)');
    expect(extraReadsFromReply('Done.')).toBeNull();
  });
});
