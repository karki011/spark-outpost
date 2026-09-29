import { describe, expect, it } from 'vitest';
import type { RankedFile } from '../codescan/rank.ts';
import type { ScanReport } from '../codescan/scan.ts';
import {
  bigByRule,
  broadRequest,
  complexByBreadth,
  complexByJev,
  complexByRequest,
  complexByScan,
  firstSignal,
  smallByRequest,
} from './builder-complexity.ts';
import { asksForTopModel, complexByRule } from './risk-rules.ts';

function file(path: string, pkg: string, termsMatched = 1, score = 1): RankedFile {
  return {
    path,
    score,
    matches: termsMatched,
    termsMatched,
    references: 0,
    lines: 10,
    symbols: 1,
    churn: 0,
    package: pkg,
    uncommitted: false,
    hasTest: null,
    reasons: [],
  };
}

function report(candidates: RankedFile[]): ScanReport {
  return { candidates } as unknown as ScanReport;
}

describe('complex by rule', () => {
  it.each([
    ['add a migration for the invoices table', 'migration'],
    ['migrate the tests to vitest', 'migration'],
    ['check permissions before deleting a project', 'security'],
    ['hash passwords with argon2', 'security'],
    ['add OAuth sign-in', 'security'],
    ['guard the query against SQL injection', 'security'],
    ['update the logger across all packages', 'multi-package'],
    ['split the monorepo build', 'multi-package'],
    ['rename fetchUser across the codebase', 'multi-package'],
  ])('%s → %s', (request, rule) => {
    expect(complexByRule(request)).toBe(rule);
  });

  it.each([
    'fix the off-by-one in daysBetween',
    'add the author name to the footer',
    'use dependency injection for the clock',
    'write docs for parseCents',
  ])('leaves everyday work alone: %s', (request) => {
    expect(complexByRule(request)).toBeNull();
  });

  it('spots an explicit ask for the top model, by phrase or current family name', () => {
    expect(asksForTopModel('use the strongest model for this')).toBe(true);
    expect(asksForTopModel('do it with a top-tier model')).toBe(true);
    expect(asksForTopModel('have Opus review the plan', ['Opus'])).toBe(true);
    expect(asksForTopModel('have Opus review the plan', [])).toBe(false);
    expect(asksForTopModel('fix the modal', ['Opus'])).toBe(false);
  });

  it('puts the user’s ask ahead of the rules', () => {
    expect(complexByRequest('use the strongest model to write a migration')).toEqual({
      source: 'user',
      reason: 'asked for the top model',
    });
    expect(complexByRequest(undefined)).toBeNull();
  });
});

describe('complex by code scan breadth', () => {
  it('counts files that match the request, and the packages they sit in', () => {
    const few = Array.from({ length: 14 }, (_, index) => file(`src/f${index}.ts`, '.'));
    expect(complexByScan(report(few))).toBeNull();
    const many = [...few, file('src/extra.ts', '.')];
    expect(complexByScan(report(many))).toEqual({
      source: 'scan',
      reason: 'matches in 15 files',
    });
    const spread = ['api', 'web', 'contracts'].map((pkg) => file(`${pkg}/a.ts`, pkg));
    expect(complexByScan(report(spread))).toEqual({
      source: 'scan',
      reason: 'matches in 3 packages',
    });
  });

  it('ignores ranked neighbours that do not match the request, and a missing scan', () => {
    const neighbours = ['api', 'web', 'contracts'].map((pkg) => file(`${pkg}/a.ts`, pkg, 0));
    expect(complexByScan(report(neighbours))).toBeNull();
    expect(complexByScan(null)).toBeNull();
    expect(complexByScan(undefined)).toBeNull();
  });

  it('counts only likely files, not loose keyword hits in other packages', () => {
    const loose = [
      file('apps/web/src/analytics/spend-summaries.ts', 'apps/web', 2, 1),
      file('packages/contracts/src/analytics.ts', 'packages/contracts', 1, 0.2),
      file('apps/server/src/analytics/spend.ts', 'apps/server', 1, 0.18),
      file('package.json', 'root', 1, 0.1),
    ];
    expect(complexByScan(report(loose))).toBeNull();
    const likely = loose.map((entry) => ({ ...entry, score: 0.6 }));
    expect(complexByScan(report(likely))?.reason).toBe('matches in 4 packages');
  });
});

const S05 =
  'Typo on the Analytics Spend tab: the source line says "was reportd by providers". Fix it.';
const S06 =
  'Bug: on Analytics a share of 2 out of 3 shows as 66%, but it should round to the nearest percent (67%). Fix it.';
const BROAD_SCAN = report(
  ['apps/web', 'packages/contracts', 'apps/server', 'root'].map((pkg) => file(`${pkg}/a.ts`, pkg)),
);

describe('code scan breadth needs a broad request', () => {
  it('keeps the dev-day typo (s05) off the top tier: Jev small and the one-line rule win', () => {
    const jev = { tier: 'small' as const, routeConfidence: 1 };
    expect(smallByRequest(S05, jev)).toBe('one-line fix');
    expect(complexByBreadth(BROAD_SCAN, S05, jev)).toEqual({
      complex: null,
      setAside: 'matches in 4 packages set aside: one-line fix',
    });
    expect(complexByBreadth(BROAD_SCAN, S05, null).complex).toBeNull();
  });

  it('keeps the dev-day rounding bug (s06) off the top tier', () => {
    expect(broadRequest(S06, { tier: 'mid', routeConfidence: 0.9 })).toBeNull();
    expect(complexByBreadth(BROAD_SCAN, S06, { tier: 'mid', routeConfidence: 0.9 })).toEqual({
      complex: null,
      setAside: null,
    });
    expect(complexByBreadth(BROAD_SCAN, S06, { tier: 'small', routeConfidence: 0.85 })).toEqual({
      complex: null,
      setAside: 'matches in 4 packages set aside: Jev small tier 0.85',
    });
  });

  it('lets an unsure Jev small call through to the broad-request check', () => {
    expect(smallByRequest(S06, { tier: 'small', routeConfidence: 0.6 })).toBeNull();
  });

  it.each([
    ['refactor the spend summaries into one module', 'broad wording'],
    ['implement CSV export for analytics', 'broad wording'],
    ['- add the column\n- update the API\n- show it in the table', 'several parts'],
    ['add a column, update the API and change the table', 'several parts'],
  ])('sends a broad request with broad matches to the top tier: %s', (request, why) => {
    expect(complexByBreadth(BROAD_SCAN, request, null)).toEqual({
      complex: { source: 'scan', reason: `matches in 4 packages, ${why}` },
      setAside: null,
    });
  });

  it('counts a confident Jev top tier or high complexity as a broad request', () => {
    const top = { tier: 'top' as const, routeConfidence: 0.9 };
    expect(complexByBreadth(BROAD_SCAN, S06, top).complex?.reason).toBe(
      'matches in 4 packages, Jev top tier',
    );
    const complexity = { tier: null, routeConfidence: null, complexity: 0.85 };
    expect(broadRequest('fix the chart', complexity)).toBe('Jev complexity high');
    expect(broadRequest('fix the chart', { ...complexity, complexity: 0.4 })).toBeNull();
  });

  it('needs breadth in the scan too', () => {
    const narrow = report([file('apps/web/a.ts', 'apps/web')]);
    expect(complexByBreadth(narrow, 'refactor the spend page', null)).toEqual({
      complex: null,
      setAside: null,
    });
  });
});

describe('complex by Jev', () => {
  it('acts only on a confident top-tier answer', () => {
    expect(complexByJev({ tier: 'top', routeConfidence: 0.85 })).toEqual({
      source: 'jev',
      reason: 'Jev top tier 0.85',
    });
    expect(complexByJev({ tier: 'top', routeConfidence: 0.62 })).toBeNull();
    expect(complexByJev({ tier: 'mid', routeConfidence: 0.99 })).toBeNull();
    expect(complexByJev({ tier: 'top', routeConfidence: null })).toBeNull();
    expect(complexByJev(null)).toBeNull();
  });

  it('takes the first signal present', () => {
    const jev = complexByJev({ tier: 'top', routeConfidence: 0.9 });
    expect(firstSignal(null, undefined, jev)).toBe(jev);
    expect(firstSignal(null)).toBeNull();
  });
});

describe('big requests plan first', () => {
  it('needs several packages, three listed items or four steps', () => {
    expect(bigByRule('Rename the helper across all the packages')).toBe('several packages');
    expect(bigByRule('- add the column\n- update the API\n- show it in the table')).toBe(
      'several parts',
    );
    expect(
      bigByRule('Add CSV export, add a download button, update the docs and write a test'),
    ).toBe('several parts');
    expect(bigByRule('The divider is wrong after midnight. Fix it and add a test.')).toBeNull();
    expect(bigByRule('fix the typo in README line 3')).toBeNull();
  });
});
