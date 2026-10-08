export const PARALLEL = `Use parallel builders, one piece per module. The modules are independent of each other: no module imports another, and each has its own test file. Do not touch any other file.`;

export const FOUR = `${PARALLEL}
1. src/slugify.ts exporting slugify(text: string): string (lower-case, spaces and punctuation to single dashes, trimmed dashes), with test/slugify.test.ts.
2. src/clamp.ts exporting clamp(value: number, min: number, max: number): number (throws RangeError when min > max), with test/clamp.test.ts.
3. src/chunk.ts exporting chunk<T>(items: readonly T[], size: number): T[][] (throws RangeError when size < 1), with test/chunk.test.ts.
4. src/range.ts exporting range(start: number, end: number, step = 1): number[] (end exclusive, supports negative steps, throws RangeError on step 0), with test/range.test.ts.
Tests use node:test and node:assert/strict like test/strings.test.ts, and \`npm test\` must pass.`;

export const BIGGER = `${PARALLEL}
1. src/slugify.ts exporting slugify(text: string, options?: { separator?: string; maxLength?: number }): string (lower-case, strips accents with normalize('NFKD'), spaces and punctuation to a single separator, trims separators, cuts at maxLength without a trailing separator), with at least 8 test cases in test/slugify.test.ts.
2. src/duration.ts exporting parseDuration(text: string): number (milliseconds from strings like "1h 30m", "45s", "2d", "250ms"; throws SyntaxError on anything else) and formatDuration(ms: number): string (the inverse, largest units first), with at least 8 test cases in test/duration.test.ts.
3. src/csv.ts exporting parseCsv(text: string): string[][] (quoted fields, escaped quotes, commas and newlines inside quotes, CRLF) and toCsv(rows: readonly string[][]): string, with at least 8 test cases in test/csv.test.ts.
4. src/lru.ts exporting class LruCache<K, V> with get, set, has, size and a capacity given to the constructor (evicts the least recently used; throws RangeError for capacity < 1), with at least 8 test cases in test/lru.test.ts.
Tests use node:test and node:assert/strict like test/strings.test.ts, and \`npm test\` must pass.`;

export const MIXED = `Use parallel builders. Three parts:
1. src/sum.ts exporting sum(values: readonly number[]): number, with test/sum.test.ts.
2. src/median.ts exporting median(values: readonly number[]): number (throws RangeError on an empty list), with test/median.test.ts.
3. src/stats.ts exporting describe(values: readonly number[]): { sum: number; mean: number; median: number } which imports sum from ./sum.ts and median from ./median.ts, with test/stats.test.ts. Part 3 depends on parts 1 and 2 and must wait for both.
Parts 1 and 2 are independent of each other. Tests use node:test like test/strings.test.ts, and \`npm test\` must pass.`;

export const COLLISION = `Use parallel builders, in 2 pieces:
1. Add truncate(text: string, max: number): string to src/strings.ts (cuts to max characters and ends with "…" when it cut), with tests added to test/strings.test.ts.
2. Add padLeft(text: string, width: number, fill = ' '): string to src/strings.ts, with tests added to test/strings.test.ts.
\`npm test\` must pass.`;

export const CROSS = `Use parallel builders, in 2 pieces that run at the same time:
1. The "report" piece owns src/report.ts and src/index.ts. src/report.ts exports renderReport(rows: readonly { name: string; hours: number }[]): string, a fixed-width text table with a header row, a separator row, right-aligned hours with one decimal, a totals row and a sorted-by-name order, with at least 10 test cases in test/report.test.ts. src/index.ts re-exports everything from ./strings.ts and ./report.ts.
2. The "initials" piece owns src/initials.ts only: initials(name: string): string ("Ada Lovelace" -> "AL"). Its test, test/initials.test.ts, must import initials from '../src/index.ts' (not from ./initials.ts), so while it works it needs \`export * from './initials.ts';\` in src/index.ts: the initials Builder should add that one line to src/index.ts itself right away, creating the file if it is not there yet, rather than wait.
\`npm test\` must pass.`;

export const MAPPED = `Use parallel builders, in 3 pieces:
1. In src/format.ts make formatMoney print "$" for USD and "€" for EUR in front of the amount (other currencies keep the code and a space), and update whatever depends on its output.
2. Add src/tax.ts exporting withTax(value: Money, rate: number): Money (rounded to whole cents), with test/tax.test.ts.
3. Add subtract(left: Money, right: Money): Money to src/money.ts, with test/money.test.ts.
\`npm test\` must pass.`;

export const TWO = `${PARALLEL}
1. src/duration.ts exporting parseDuration(text: string): number (milliseconds from strings like "1h 30m", "45s", "2d", "250ms"; throws SyntaxError on anything else) and formatDuration(ms: number): string (the inverse, largest units first), with at least 10 test cases in test/duration.test.ts.
2. src/csv.ts exporting parseCsv(text: string): string[][] (quoted fields, escaped quotes, commas and newlines inside quotes, CRLF) and toCsv(rows: readonly string[][]): string, with at least 10 test cases in test/csv.test.ts.
Tests use node:test and node:assert/strict like test/strings.test.ts, and \`npm test\` must pass.`;
