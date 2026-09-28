import { describe, expect, it } from 'vitest';
import type { RankedFile } from '../codescan/rank.ts';
import type { ScanReport } from '../codescan/scan.ts';
import {
  complexByJev,
  complexByRequest,
  complexByScan,
  firstSignal,
} from './builder-complexity.ts';
import { asksForTopModel, complexByRule } from './risk-rules.ts';

function file(path: string, pkg: string, termsMatched = 1): RankedFile {
  return {
    path,
    score: 1,
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
