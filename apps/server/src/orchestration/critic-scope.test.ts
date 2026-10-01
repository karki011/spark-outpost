import { describe, expect, it } from 'vitest';
import { findingKind, readFindings } from '../advisor/finding-questions.ts';
import { addedLines, insideFix, sameConcern, scopeRecheck } from './critic-scope.ts';

const RATE_REQUEST =
  'Add `src/rate-limit.ts` exporting a `RateLimiter` class: `new RateLimiter({ limit, windowMs })` and `allow(key: string, now: number): boolean` using a fixed window per key.';

const ROUND_ONE_BUG =
  '[bug] `src/rate-limit.ts:15`: Revisiting an earlier valid window resets its count. With `limit: 1`, calls at `0`, `1000`, then `0` all return `true`.';
const ROUND_ONE_NOTE =
  '[hardening] `src/rate-limit.ts:7`: Invalid numeric inputs can bypass the limit. For example, `windowMs: 0` or `now: NaN` resets the window on every call; validate the options and timestamp.';
const MEMORY_NOTE =
  '[hardening] `src/rate-limit.ts:5`: Entries for distinct keys are never removed, so memory grows without bound as new keys arrive.';

const FIX_PATCH = `diff --git a/src/rate-limit.ts b/src/rate-limit.ts
--- a/src/rate-limit.ts
+++ b/src/rate-limit.ts
@@ -12,6 +12,9 @@ export class RateLimiter {
   allow(key: string, now: number): boolean {
     const start = Math.floor(now / this.windowMs) * this.windowMs;
-    const current = this.windows.get(key);
+    const windows = this.windows.get(key) ?? new Map<number, number>();
+    const count = windows.get(start) ?? 0;
+    windows.set(start, count + 1);
+    this.windows.set(key, windows);
     return count < this.limit;
   }
 }
`;

const REGRESSION =
  '[bug] `src/rate-limit.ts:16`: The earlier-window reset is fixed, but the replacement rejects requests that still have capacity in that window.';
const ESCALATED_NOTE =
  '[bug] `src/rate-limit.ts:7`: A zero `windowMs` or non-finite `now` produces a `NaN` window start, so each call starts a new window and the limit is bypassed.';
const UNTOUCHED =
  '[bug] `src/csv-export.ts:9`: A field with a leading space is not quoted, so some readers trim it.';
const FRACTIONAL =
  '[bug] `src/rate-limit.ts:20`: The constructor accepts fractional `windowMs`, so `windowMs: 0.1` puts calls at `0.2` and `0.3` in the same window.';

describe('the fix diff', () => {
  it('lists the new-side line numbers each fix added', () => {
    expect(addedLines(FIX_PATCH).get('src/rate-limit.ts')).toEqual([14, 15, 16, 17]);
  });

  it('places a finding inside the fix only near a line the fix added', () => {
    const fix = addedLines(FIX_PATCH);
    expect(insideFix(REGRESSION, fix)).toBe(true);
    expect(insideFix(ESCALATED_NOTE, fix)).toBe(false);
    expect(insideFix(UNTOUCHED, fix)).toBe(false);
    expect(insideFix('[bug] The limiter allows one call too many.', fix)).toBe(true);
  });
});

describe('the same concern in other words', () => {
  it('matches a reworded note and keeps different problems apart', () => {
    expect(
      sameConcern(
        MEMORY_NOTE,
        '[bug] `src/rate-limit.ts:5`: Counts for every key remain in memory; memory grows without bound for new keys.',
      ),
    ).toBe(true);
    expect(sameConcern(ROUND_ONE_BUG, REGRESSION)).toBe(false);
  });
});

describe('degenerate-input validation is a note unless the request asks for it (C)', () => {
  it('reads validation of zero, NaN or fractional options as a suggestion even when tagged [bug]', () => {
    expect(findingKind(ESCALATED_NOTE.replace('produces', 'produces; validate it:'))).toBe(
      'suggestion',
    );
    expect(findingKind(FRACTIONAL, RATE_REQUEST)).toBe('suggestion');
    expect(
      findingKind(
        '[bug] `src/rate-limit.ts:11`: `limit` is unchecked. With `NaN` or `Infinity`, every call is allowed.',
      ),
    ).toBe('suggestion');
    expect(findingKind('[bug] `divide(1, 0)` returns Infinity instead of throwing.')).toBe('bug');
    expect(findingKind(ROUND_ONE_BUG, RATE_REQUEST)).toBe('bug');
  });

  it('keeps it a bug when the request asks for validation', () => {
    expect(findingKind(FRACTIONAL, `${RATE_REQUEST} Reject invalid options.`)).toBe('bug');
  });
});

describe('a recheck only confirms fixes and judges the fix diff (C)', () => {
  const recheck = (findings: readonly string[]) =>
    scopeRecheck(readFindings(findings, null, { request: RATE_REQUEST }), {
      previous: [ROUND_ONE_BUG],
      notes: [ROUND_ONE_NOTE, MEMORY_NOTE],
      fixPatch: FIX_PATCH,
    });

  it('keeps a bug the fix introduced and an earlier finding that is still open', () => {
    const readings = recheck([REGRESSION, ROUND_ONE_BUG]);
    expect(readings.map((reading) => reading.correct)).toEqual([true, true]);
  });

  it('turns an escalated earlier note and a bug in untouched code into notes', () => {
    const readings = recheck([
      '[bug] `src/rate-limit.ts:16`: Entries for distinct keys are never removed, so memory grows without bound.',
      UNTOUCHED,
      FRACTIONAL,
    ]);
    expect(readings.map((reading) => [reading.correct, reading.kind, reading.scope])).toEqual([
      [false, 'suggestion', 'earlier_note'],
      [false, 'suggestion', 'outside_fix'],
      [false, 'suggestion', undefined],
    ]);
  });

  it('judges by the findings alone when no fix diff is known', () => {
    const [reading] = scopeRecheck(readFindings([UNTOUCHED], null), {
      previous: [ROUND_ONE_BUG],
      notes: [],
      fixPatch: null,
    });
    expect(reading!.correct).toBe(true);
  });
});
