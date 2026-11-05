import { describe, expect, it } from 'vitest';
import { createResolver } from './resolve.ts';
import { parseJsonc, readResolverConfig } from './resolver-config.ts';

const TEXT: Record<string, string> = {
  'tsconfig.base.json':
    '{ "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["libs/*/src"] } } }',
  'apps/web/tsconfig.json': `{
    // comments and trailing commas are fine
    "extends": "../../tsconfig.base.json",
    "compilerOptions": { "paths": { "@/*": ["./src/*"], }, },
  }`,
  'packages/contracts/package.json':
    '{ "name": "@acme/contracts", "exports": { ".": "./dist/index.js", "./ids": { "types": "./dist/ids.d.ts", "import": "./dist/ids.js" } } }',
  'packages/ui/package.json': '{ "name": "@acme/ui", "main": "lib/index.js" }',
  'go.mod': 'module example.com/shop\n\ngo 1.22\n',
  'services/py/pyproject.toml': '[project]\nname = "py"\n',
};

const FILES = [
  ...Object.keys(TEXT),
  'apps/web/src/main.tsx',
  'apps/web/src/api/client.ts',
  'apps/web/src/api/index.ts',
  'apps/web/src/styles.css',
  'libs/charts/src/index.ts',
  'packages/contracts/src/index.ts',
  'packages/contracts/src/ids.ts',
  'packages/ui/src/index.ts',
  'store/store.go',
  'store/store_test.go',
  'store/cache.go',
  'cmd/main.go',
  'services/py/src/app/__init__.py',
  'services/py/src/app/models.py',
  'services/py/src/app/api/routes.py',
];

async function resolver() {
  const config = await readResolverConfig(FILES, async (path) => TEXT[path] ?? null);
  return createResolver(new Set(FILES), config);
}

describe('import resolution', () => {
  it('parses JSON with comments and trailing commas', () => {
    expect(parseJsonc('{ "a": "// not a comment", /* x */ "b": [1,], }')).toEqual({
      a: '// not a comment',
      b: [1],
    });
  });

  it('resolves relative imports with extension probing, index files and .js to .ts', async () => {
    const r = await resolver();
    expect(r.resolve('apps/web/src/main.tsx', './api', 'script')).toEqual([
      'apps/web/src/api/index.ts',
    ]);
    expect(r.resolve('apps/web/src/main.tsx', './api/client.js', 'script')).toEqual([
      'apps/web/src/api/client.ts',
    ]);
    expect(r.resolve('apps/web/src/main.tsx', './styles.css?inline', 'script')).toEqual([
      'apps/web/src/styles.css',
    ]);
    expect(r.resolve('apps/web/src/main.tsx', '../../../../outside', 'script')).toEqual([]);
  });

  it('resolves tsconfig path aliases, including ones inherited through extends', async () => {
    const r = await resolver();
    expect(r.resolve('apps/web/src/main.tsx', '@/api/client', 'script')).toEqual([
      'apps/web/src/api/client.ts',
    ]);
    expect(r.resolve('apps/web/src/main.tsx', '@lib/charts', 'script')).toEqual([
      'libs/charts/src/index.ts',
    ]);
  });

  it('resolves workspace packages through exports, main and build-to-source twins', async () => {
    const r = await resolver();
    expect(r.resolve('apps/web/src/main.tsx', '@acme/contracts', 'script')).toEqual([
      'packages/contracts/src/index.ts',
    ]);
    expect(r.resolve('apps/web/src/main.tsx', '@acme/contracts/ids', 'script')).toEqual([
      'packages/contracts/src/ids.ts',
    ]);
    expect(r.resolve('apps/web/src/main.tsx', '@acme/ui', 'script')).toEqual([
      'packages/ui/src/index.ts',
    ]);
    expect(r.resolve('apps/web/src/main.tsx', 'react', 'script')).toEqual([]);
  });

  it('resolves Python absolute and relative modules and Go packages', async () => {
    const r = await resolver();
    const from = 'services/py/src/app/api/routes.py';
    expect(r.resolve(from, 'app.models', 'python')).toEqual(['services/py/src/app/models.py']);
    expect(r.resolve(from, '..models', 'python')).toEqual(['services/py/src/app/models.py']);
    expect(r.resolve(from, '..', 'python')).toEqual(['services/py/src/app/__init__.py']);
    expect(r.resolve('cmd/main.go', 'example.com/shop/store', 'go')).toEqual([
      'store/cache.go',
      'store/store.go',
    ]);
    expect(r.resolve('cmd/main.go', 'fmt', 'go')).toEqual([]);
  });
});
