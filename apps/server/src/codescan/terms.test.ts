import { describe, expect, it } from 'vitest';
import { extractTerms, nameVariants, pascalForm, searchPatterns, spellings } from './terms.ts';

describe('extractTerms', () => {
  it('never turns secrets in the request into search terms', () => {
    const secrets = [
      'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv',
      'ghp_abcdefghijklmnopqrstuvwxyz0123',
      'github_pat_11ABCDEFG0123456789_abcdefghijklmnop',
      'xoxb-1234567890-0987654321-AbCdEfGhIjKl',
      'AKIAIOSFODNN7EXAMPLE',
    ];
    const terms = extractTerms(
      `Wire the key \`${secrets[0]}\` into src/${secrets[1]}/client.ts, and use ${secrets[2]}, ${secrets[3]}, "${secrets[4]}" in fetchUser`,
    );
    const stored = JSON.stringify(terms);
    const searched = searchPatterns(terms).join(' ');
    for (const secret of secrets) {
      expect(stored).not.toContain(secret);
      expect(searched).not.toContain(secret);
    }
    expect(stored).not.toContain('redacted');
    expect(terms.identifiers).toContain('fetchUser');
  });

  it('pulls paths, file names and code-shaped words from a request', () => {
    const terms = extractTerms(
      'In apps/server/src/orchestration/orchestrator.ts, call recordScan from runIntake and update scan_results via the `ScanReport` type in lean.test.ts.',
    );
    expect(terms.paths).toEqual(['apps/server/src/orchestration/orchestrator.ts']);
    expect(terms.fileNames).toEqual(['lean.test.ts']);
    expect(terms.identifiers).toEqual(['ScanReport', 'recordScan', 'runIntake', 'scan_results']);
  });

  it('keeps kebab, screaming and single PascalCase names but not sentence starters', () => {
    const terms = extractTerms(
      'Rename the Button component in date-picker. Then raise MAX_RETRY_COUNT. Also check it.',
    );
    expect(terms.identifiers).toEqual(['Button', 'date-picker', 'MAX_RETRY_COUNT']);
  });

  it('treats quoted text with spaces as a phrase to search for', () => {
    const terms = extractTerms('The "Export CSV" button does nothing when clicked');
    expect(terms.phrases).toEqual(['Export CSV']);
    expect(terms.identifiers).toEqual([]);
  });

  it('keeps plain nouns as words to match against file paths', () => {
    const terms = extractTerms(
      'The sidebar order breaks when a pinned conversation is archived; fix it in date-picker',
    );
    expect(terms.words).toEqual([
      'sidebar',
      'order',
      'breaks',
      'pinned',
      'conversation',
      'archived',
    ]);
    expect(terms.identifiers).toEqual(['date-picker']);
  });

  it('ignores URLs and plain prose', () => {
    const terms = extractTerms('see https://example.com/docs/page and make it faster please');
    expect(terms.paths).toEqual([]);
    expect(terms.identifiers).toEqual([]);
    expect(terms.words).toEqual(['faster']);
  });

  it('caps the number of identifiers', () => {
    const many = Array.from({ length: 30 }, (_, index) => `fooBar${index}`).join(' ');
    expect(extractTerms(many).identifiers).toHaveLength(12);
  });
});

describe('nameVariants', () => {
  it('spells a multi-word name in each common case', () => {
    expect(nameVariants('date-picker')).toEqual([
      'date-picker',
      'DatePicker',
      'datePicker',
      'date_picker',
    ]);
    expect(nameVariants('useChartData')).toEqual([
      'useChartData',
      'UseChartData',
      'use_chart_data',
      'use-chart-data',
    ]);
    expect(nameVariants('Button')).toEqual(['Button']);
  });
});

describe('searchPatterns', () => {
  it('searches camel names as written and expands kebab and snake names', () => {
    const patterns = searchPatterns({
      paths: [],
      fileNames: [],
      identifiers: ['useChartData', 'line-chart'],
      phrases: ['Export CSV'],
      words: [],
    });
    expect(patterns).toEqual([
      'useChartData',
      'line-chart',
      'LineChart',
      'lineChart',
      'line_chart',
      'Export CSV',
    ]);
  });
});

describe('pascalForm', () => {
  it('spells a name in PascalCase for partial definition lookups', () => {
    expect(pascalForm('SearchInput')).toBe('SearchInput');
    expect(pascalForm('searchInput')).toBe('SearchInput');
    expect(pascalForm('date-picker')).toBe('DatePicker');
  });
});

describe('spellings', () => {
  it('looks up code-shaped names as written and expands kebab and snake names', () => {
    expect(spellings('SearchInput')).toEqual(['SearchInput']);
    expect(spellings('date-picker')).toContain('DatePicker');
  });
});
