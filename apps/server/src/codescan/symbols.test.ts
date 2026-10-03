import { describe, expect, it } from 'vitest';
import { SYMBOL_LANGUAGES, type SymbolLanguage } from './languages.ts';
import { extractSymbols } from './symbols.ts';

const SAMPLES: Record<SymbolLanguage, { source: string; defines: string[]; uses: string[] }> = {
  typescript: {
    source:
      'import { Button } from "./ui";\nexport interface ChartProps { size: number }\nexport function useChartData(props: ChartProps) { return Button.render(props); }\nexport const chartTheme = makeTheme();\nclass Widget { paint() {} }',
    defines: ['ChartProps', 'useChartData', 'chartTheme', 'Widget', 'paint'],
    uses: ['Button', 'render', 'makeTheme'],
  },
  tsx: {
    source: 'export function Card() { return <Button label="x" />; }\ntype Size = "s";',
    defines: ['Card', 'Size'],
    uses: ['Button'],
  },
  javascript: {
    source: 'function loadRows() { return fetchRows(); }\nclass Store {}',
    defines: ['loadRows', 'Store'],
    uses: ['fetchRows'],
  },
  python: {
    source: 'class Loader:\n    def load(self):\n        return read_file()\nLIMIT = 3\n',
    defines: ['Loader', 'load', 'LIMIT'],
    uses: ['read_file'],
  },
  go: {
    source:
      'package main\ntype Server struct{}\nfunc (s *Server) Serve() { handleConn() }\nfunc main() {}',
    defines: ['Server', 'Serve', 'main'],
    uses: ['handleConn'],
  },
  rust: {
    source: 'struct Matcher;\ntrait Search {}\nfn run() { build_matcher(); }',
    defines: ['Matcher', 'Search', 'run'],
    uses: ['build_matcher'],
  },
  java: {
    source: 'class Parser { void parse() { Lexer.next(); } }',
    defines: ['Parser', 'parse'],
    uses: ['Lexer', 'next'],
  },
  'c-sharp': {
    source: 'class Repo { void Save() { Store.Write(); } }',
    defines: ['Repo', 'Save'],
    uses: ['Store', 'Write'],
  },
  cpp: {
    source: 'struct Node {};\nint compute(int x) { return helper(x); }',
    defines: ['Node', 'compute'],
    uses: ['helper'],
  },
  ruby: {
    source: 'class Invoice\n  def total\n    sum_lines\n  end\nend',
    defines: ['Invoice', 'total'],
    uses: ['sum_lines'],
  },
  php: {
    source: '<?php\nclass Mailer { function send() { return format_body(); } }',
    defines: ['Mailer', 'send'],
    uses: ['format_body'],
  },
  bash: {
    source: 'deploy() {\n  rsync -a . host:\n}\ndeploy',
    defines: ['deploy'],
    uses: ['rsync'],
  },
};

describe('extractSymbols', () => {
  it.each(SYMBOL_LANGUAGES)('finds definitions and references in %s', async (language) => {
    const sample = SAMPLES[language];
    const symbols = await extractSymbols(language, sample.source);
    const defined = symbols.definitions.map((definition) => definition.name);
    expect(defined).toEqual(expect.arrayContaining(sample.defines));
    expect(symbols.references).toEqual(expect.arrayContaining(sample.uses));
    for (const name of sample.defines) expect(symbols.references).not.toContain(name);
  });

  it('does not treat mock factories or mock functions as definitions', async () => {
    const symbols = await extractSymbols(
      'typescript',
      [
        "vi.mock('./api', () => ({ useBudgets() { return []; } }));",
        "jest.mock('./flags', () => { function useFeatureFlag() { return true; } return { useFeatureFlag }; });",
        'const useUploadCsv = vi.fn().mockReturnValue(null);',
        'export function renderPanel() { return useUploadCsv(); }',
      ].join('\n'),
    );
    expect(symbols.definitions.map((definition) => definition.name)).toEqual(['renderPanel']);
    expect(symbols.references).toEqual(expect.arrayContaining(['useUploadCsv']));
  });

  it('keeps functions but not variables as definitions in test files', async () => {
    const source = [
      'const useUploadCsv = api.useUploadCsv as unknown as Mock;',
      'const searchInput = () => screen.getByRole("searchbox");',
      'function renderPanel() { return null; }',
    ].join('\n');
    const inTest = await extractSymbols('typescript', source, true);
    expect(inTest.definitions.map((definition) => definition.name)).toEqual(['renderPanel']);
    const inSource = await extractSymbols('typescript', source);
    expect(inSource.definitions).toHaveLength(3);
  });

  it('records the first and last line of each declaration', async () => {
    const source = [
      'import { Button } from "./ui";',
      '',
      'export interface ChartProps {',
      '  size: number;',
      '}',
      '',
      'export const loadChart = async (',
      '  props: ChartProps,',
      ') => {',
      '  return Button.render(props);',
      '};',
      '',
      'export class Widget {',
      '  paint() {',
      '    return 1;',
      '  }',
      '}',
    ].join('\n');
    const symbols = await extractSymbols('typescript', source);
    const ranges = Object.fromEntries(
      symbols.definitions.map((definition) => [
        definition.name,
        [definition.startLine, definition.endLine],
      ]),
    );
    expect(ranges).toEqual({
      ChartProps: [3, 5],
      loadChart: [7, 11],
      Widget: [13, 17],
      paint: [14, 16],
    });
  });

  it('covers the whole function for declarator-style languages', async () => {
    const cpp = await extractSymbols(
      'cpp',
      'int compute(int x) {\n  return helper(x);\n}\nint Node::size() {\n  return 1;\n}\n',
    );
    expect(
      cpp.definitions.map((definition) => [
        definition.name,
        definition.startLine,
        definition.endLine,
      ]),
    ).toEqual([
      ['compute', 1, 3],
      ['size', 4, 6],
    ]);
    const python = await extractSymbols(
      'python',
      'class Loader:\n    def load(self):\n        return read_file()\n\nLIMIT = 3\n',
    );
    expect(
      python.definitions.map((definition) => [
        definition.name,
        definition.startLine,
        definition.endLine,
      ]),
    ).toEqual([
      ['Loader', 1, 3],
      ['load', 2, 3],
      ['LIMIT', 5, 5],
    ]);
  });

  it('skips names shorter than three characters', async () => {
    const symbols = await extractSymbols('typescript', 'const ab = cd(ef);');
    expect(symbols.definitions).toEqual([]);
    expect(symbols.references).toEqual([]);
  });

  it('extracts import specifiers for scripts, Python and Go', async () => {
    const script = await extractSymbols(
      'tsx',
      "import a from './a';\nimport type { B } from '@app/b';\nexport * from '../c.js';\nconst d = await import('./d');\nconst e = require('e');\nfoo('./not-an-import');",
    );
    expect(script.imports).toEqual(['./a', '@app/b', '../c.js', './d', 'e']);
    const python = await extractSymbols(
      'python',
      'import os, pkg.mod as m\nfrom . import sibling\nfrom ..core.models import User, Order\nfrom api import *\n',
    );
    expect(python.imports).toEqual([
      'os',
      'pkg.mod',
      '.sibling',
      '..core.models',
      '..core.models.User',
      '..core.models.Order',
      'api',
    ]);
    const go = await extractSymbols(
      'go',
      'package x\nimport (\n "fmt"\n y "example.com/app/store"\n)\n',
    );
    expect(go.imports).toEqual(['fmt', 'example.com/app/store']);
  });
});
