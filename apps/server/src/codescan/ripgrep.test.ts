import { describe, expect, it } from 'vitest';
import { matchReader, parseMatches } from './ripgrep.ts';

const OUTPUT = [
  './src/chart/line-chart.tsx\0useChartData',
  './src/chart/line-chart.tsx\0useChartData',
  'src/chart/line-chart.tsx\0LineChart',
  'node_modules/dep/index.js\0useChartData',
  'node_modules/dep/index.js\0LineChart',
  'src/data/load-séries.ts\0useChartData',
  'src/data/other.ts\0notAsked',
  'a line without a separator',
  'src/last.ts\0LineChart',
].join('\n');

const PATTERNS = ['useChartData', 'LineChart'];

function summary(matches: ReadonlyMap<string, { count: number; terms: Set<string> }>) {
  return [...matches].map(([path, match]) => [path, match.count, [...match.terms]]);
}

describe('ripgrep output', () => {
  it('counts matches per file and drops skipped paths and unknown terms', () => {
    expect(summary(parseMatches(OUTPUT, PATTERNS))).toEqual([
      ['src/chart/line-chart.tsx', 3, ['useChartData', 'LineChart']],
      ['src/data/load-séries.ts', 1, ['useChartData']],
      ['src/last.ts', 1, ['LineChart']],
    ]);
  });

  it('gives the same matches when the output arrives in pieces of any size', () => {
    const whole = summary(parseMatches(OUTPUT, PATTERNS));
    for (const size of [1, 2, 7, 64, OUTPUT.length]) {
      const reader = matchReader(PATTERNS);
      for (let start = 0; start < OUTPUT.length; start += size) {
        reader.read(OUTPUT.slice(start, start + size));
      }
      reader.end();
      expect(summary(reader.matches)).toEqual(whole);
    }
  });

  it('reads a last line that ends with a line break', () => {
    expect(summary(parseMatches('src/a.ts\0LineChart\n', PATTERNS))).toEqual([
      ['src/a.ts', 1, ['LineChart']],
    ]);
  });
});
