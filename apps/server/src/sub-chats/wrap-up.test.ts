import { describe, expect, it } from 'vitest';
import { mergeOrder, wrapUpBody, type WrapUpPiece } from './wrap-up.ts';

const RECORD = { branch: 'spark/orders-api', committed: true, pushed: true, pullRequest: null };

function piece(id: string, overrides: Partial<WrapUpPiece> = {}): WrapUpPiece {
  return {
    id,
    title: id,
    position: 0,
    status: 'ready_for_review',
    reason: null,
    record: RECORD,
    stackedOn: null,
    ...overrides,
  };
}

const PLAN = [
  piece('Orders API', {
    record: {
      ...RECORD,
      pullRequest: {
        number: 41,
        url: 'https://github.com/acme/shop/pull/41',
        state: 'open',
        checks: 'passing',
      },
    },
  }),
  piece('Orders page', {
    position: 1,
    status: 'needs_you',
    reason: 'Its turn\nfailed.',
    record: { branch: 'spark/orders-page', committed: false, pushed: false, pullRequest: null },
    stackedOn: 'Orders API',
  }),
  piece('Docs', {
    position: 2,
    status: 'held',
    reason: 'Held: “Orders page” did not finish. Start anyway starts it.',
    record: null,
  }),
];

describe('the wrap-up Spark writes for a parent', () => {
  it('says Spark wrote it, not the user, and asks for a report and no new work', () => {
    const lines = wrapUpBody(PLAN).split('\n');
    expect(lines[0]).toContain('Spark wrote this message; the user did not write it.');
    expect(lines.at(-1)).toContain('This is a report and asks for no new work.');
  });

  it('gives each sub-chat its status with Spark’s own record, by title', () => {
    const text = wrapUpBody(PLAN);
    expect(text).toContain(
      '“Orders API”: Ready for review · branch spark/orders-api · committed · pushed · pull request #41 (open, checks passing) https://github.com/acme/shop/pull/41',
    );
    expect(text).toContain(
      '“Orders page”: Needs you (Its turn failed.) · branch spark/orders-page · not committed · not pushed · no pull request · stacked on “Orders API”',
    );
    expect(text).toContain(
      '“Docs”: Held (Held: “Orders page” did not finish. Start anyway starts it.)',
    );
    expect(text).toContain("Spark's own record as it is now");
    expect(text).not.toContain('@');
  });

  it('gives the order to merge a stack, base first', () => {
    expect(wrapUpBody(PLAN)).toContain(
      'Merge the stacked pull requests in this order: “Orders API”, then “Orders page”.',
    );
    const chain = [
      piece('c', { position: 0, stackedOn: 'b' }),
      piece('b', { position: 1, stackedOn: 'a' }),
      piece('a', { position: 2 }),
      piece('alone', { position: 3 }),
    ];
    expect(mergeOrder(chain)).toEqual(['a', 'b', 'c']);
  });

  it('names no merge order when nothing is stacked', () => {
    const flat = [piece('a'), piece('b', { position: 1 })];
    expect(mergeOrder(flat)).toEqual([]);
    expect(wrapUpBody(flat)).not.toContain('Merge the stacked');
  });

  it('ignores a stack base that is no longer among the sub-chats', () => {
    expect(mergeOrder([piece('b', { stackedOn: 'gone' })])).toEqual([]);
  });
});
