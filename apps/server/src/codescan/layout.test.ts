import { describe, expect, it } from 'vitest';
import { manifestName, packageMatcher, readLayout } from './layout.ts';
import { ownersMatcher } from './owners.ts';

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
