import { describe, expect, it } from 'vitest';
import type { LawFacts } from './finding.ts';
import { findRemovals, removalFindings } from './removals.ts';

const facts = (overrides: Partial<LawFacts> = {}): LawFacts => ({
  request: 'Add a CSV export to the report page.',
  replies: ['Added the export button and the CSV writer.'],
  plan: [],
  ...overrides,
});

const deletedFile = `diff --git a/src/legacy.ts b/src/legacy.ts
deleted file mode 100644
index 1111111..0000000
--- a/src/legacy.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export function legacy() {
-  return 1;
-}
`;

const removedFunction = `diff --git a/src/auth.ts b/src/auth.ts
index 1111111..2222222 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,9 +1,4 @@
 export function login() {
   return true;
 }
-
-export function helperTotals(rows) {
-  return rows.length;
-}
-
`;

const removedGuard = `diff --git a/src/routes.ts b/src/routes.ts
index 1111111..2222222 100644
--- a/src/routes.ts
+++ b/src/routes.ts
@@ -10,4 +10,3 @@
 app.post('/reports', (req, res) => {
-  requireAuth(req);
   res.json(save(req.body));
`;

const removedTest = `diff --git a/src/math.test.ts b/src/math.test.ts
index 1111111..2222222 100644
--- a/src/math.test.ts
+++ b/src/math.test.ts
@@ -1,8 +1,4 @@
 it('adds', () => {
   expect(add(1, 2)).toBe(3);
 });
-it('adds negatives', () => {
-  expect(add(-1, -2)).toBe(-3);
-});
`;

const movedFunction = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,0 @@
-export function parseCents(text) {
-  return 1;
-}
diff --git a/src/b.ts b/src/b.ts
index 1111111..2222222 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,0 +1,3 @@
+export function parseCents(text) {
+  return 1;
+}
`;

function bigBlock(lines: number): string {
  const removed = Array.from({ length: lines }, (_, index) => `-  row(${index});`).join('\n');
  return `diff --git a/src/table.ts b/src/table.ts
index 1111111..2222222 100644
--- a/src/table.ts
+++ b/src/table.ts
@@ -40,${lines} +40,0 @@
${removed}
`;
}

describe('Chesterton removals', () => {
  it('flags a deleted file, a removed function, a removed test and a removed guard', () => {
    const patch = [deletedFile, removedFunction, removedTest, removedGuard].join('');
    expect(removalFindings(patch, facts()).map((finding) => [finding.kind, finding.text])).toEqual([
      ['file', 'Removed `src/legacy.ts` — why?'],
      ['symbol', 'Removed `helperTotals` from `src/auth.ts` — why?'],
      ['test', 'Removed test `adds negatives` from `src/math.test.ts` — why?'],
      ['guard', 'Removed a check in `src/routes.ts`: `requireAuth(req);` — why?'],
    ]);
  });

  it('does not flag a removal the Builder explains', () => {
    const replies = ['Removed helperTotals because nothing calls it any more.'];
    expect(removalFindings(removedFunction, facts({ replies }))).toEqual([]);
  });

  it('does not flag a removal the request asks for', () => {
    const request = 'Delete src/legacy.ts, it is not used.';
    expect(removalFindings(deletedFile, facts({ request }))).toEqual([]);
    expect(removalFindings(removedFunction, facts({ request: 'Remove dead code.' }))).toEqual([]);
  });

  it('does not count a reply that names the code without saying it was removed', () => {
    const replies = ['helperTotals now reads the cached rows.'];
    expect(removalFindings(removedFunction, facts({ replies }))).toHaveLength(1);
  });

  it('treats a function that moved to another file as kept', () => {
    expect(findRemovals(movedFunction)).toEqual([]);
  });

  it('flags a large removed block only when nothing more specific was found', () => {
    expect(findRemovals(bigBlock(29))).toEqual([]);
    expect(findRemovals(bigBlock(30)).map((removal) => removal.text)).toEqual([
      'Removed 30 lines from `src/table.ts` around line 40 — why?',
    ]);
  });
});
