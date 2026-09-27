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

  it('skips names shorter than three characters', async () => {
    const symbols = await extractSymbols('typescript', 'const ab = cd(ef);');
    expect(symbols.definitions).toEqual([]);
    expect(symbols.references).toEqual([]);
  });
});
