import { describe, expect, it } from 'vitest';
import { parseLog, parseStatus } from './git.ts';
import { churnByFile, coChanged } from './history.ts';
import { manifestName, packageMatcher, readLayout } from './layout.ts';
import { ownersMatcher, parseCodeowners } from './owners.ts';
import { skipReason } from './skip.ts';
import { isTestFile, pairTests } from './test-pairs.ts';

describe('readLayout', () => {
  const files: Record<string, string> = {
    'package.json': '{"name":"root","workspaces":["libs/*"]}',
    'nx.json': '{}',
    'pnpm-workspace.yaml': 'packages: [libs/*]',
    'libs/ui/button/project.json': '{"name":"ui-button"}',
    'libs/ui/button/src/button.tsx': '',
    'services/api/go.mod': 'module example.com/api\n',
    'crates/core/Cargo.toml': '[package]\nname = "core"\n',
    '.github/CODEOWNERS': '* @all\n/libs/ui/ @design\n',
    'AGENTS.md': '',
    '.cursor/rules/style.mdc': '',
  };

  it('finds packages, tools, instruction files and owners', async () => {
    const layout = await readLayout(Object.keys(files), async (path) => files[path] ?? null);
    expect(layout.tools).toEqual(['pnpm', 'nx', 'workspaces']);
    expect(layout.packages.map((entry) => entry.name)).toEqual([
      'root',
      'core',
      'ui-button',
      'example.com/api',
    ]);
    expect(layout.instructions).toEqual(['.cursor/rules/style.mdc', 'AGENTS.md']);
    const packageOf = packageMatcher(layout.packages);
    expect(packageOf('libs/ui/button/src/button.tsx')).toBe('ui-button');
    expect(packageOf('services/api/main.go')).toBe('example.com/api');
    expect(packageOf('README.md')).toBe('root');
    const ownersOf = ownersMatcher(layout.owners);
    expect(ownersOf('libs/ui/button/src/button.tsx')).toEqual(['@design']);
    expect(ownersOf('services/api/main.go')).toEqual(['@all']);
  });

  it('reads names from each manifest kind', () => {
    expect(manifestName('pyproject.toml', '[project]\nname = "tool"\n')).toBe('tool');
    expect(manifestName('Cargo.toml', '[workspace]\nmembers = []\n')).toBeNull();
    expect(manifestName('package.json', 'not json')).toBeNull();
  });
});

describe('CODEOWNERS', () => {
  it('lets the last matching rule win and supports globs', () => {
    const ownersOf = ownersMatcher(
      parseCodeowners('# comment\n*.ts @ts\ndocs/ @docs\n/apps/**/api/ @api\n'),
    );
    expect(ownersOf('src/a.ts')).toEqual(['@ts']);
    expect(ownersOf('docs/guide.md')).toEqual(['@docs']);
    expect(ownersOf('apps/web/api/client.ts')).toEqual(['@api']);
    expect(ownersOf('README.md')).toEqual([]);
  });
});

describe('pairTests', () => {
  it('pairs sources with tests by name, nearby or in the same package', () => {
    const paths = [
      'src/chart.ts',
      'src/chart.test.ts',
      'src/util/index.ts',
      'src/other/index.test.ts',
      'src/store.ts',
      'test/store.db.test.ts',
      'pkg/server.go',
      'pkg/server_test.go',
      'app/models.py',
      'tests/test_models.py',
      'src/lonely.ts',
    ];
    const tested = pairTests(paths, () => 'one');
    expect([...tested].sort()).toEqual([
      'app/models.py',
      'pkg/server.go',
      'src/chart.ts',
      'src/store.ts',
    ]);
    expect(isTestFile('src/__tests__/chart.ts')).toBe(true);
    expect(isTestFile('src/chart.ts')).toBe(false);
  });
});

describe('skipReason', () => {
  it('skips dependencies, build output, lockfiles, generated and binary files', () => {
    expect(skipReason('node_modules/x/index.js')).toBe('directory');
    expect(skipReason('apps/web/dist/main.js')).toBe('directory');
    expect(skipReason('pnpm-lock.yaml')).toBe('lockfile');
    expect(skipReason('public/app.min.js')).toBe('generated');
    expect(skipReason('assets/logo.png')).toBe('binary');
    expect(skipReason('src/build-style.ts')).toBeNull();
  });
});

describe('git output', () => {
  it('parses porcelain status including renames', () => {
    expect(parseStatus(' M src/a.ts\0R  src/new.ts\0src/old.ts\0?? notes.md\0')).toEqual([
      'src/a.ts',
      'src/new.ts',
      'notes.md',
    ]);
  });

  it('parses log records into commits and derives churn and co-change', () => {
    const commits = parseLog(
      '\u001e200\n\na.ts\nb.ts\n\u001e100\n\na.ts\nc.ts\n\u001e50\n\nd.ts\n',
    );
    expect(commits).toEqual([
      { at: 200, files: ['a.ts', 'b.ts'] },
      { at: 100, files: ['a.ts', 'c.ts'] },
      { at: 50, files: ['d.ts'] },
    ]);
    expect(churnByFile(commits).get('a.ts')).toBe(2);
    expect([...coChanged(commits, new Set(['a.ts']))]).toEqual([
      ['b.ts', 1],
      ['c.ts', 1],
    ]);
  });
});
