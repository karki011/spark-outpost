import { describe, expect, it } from 'vitest';
import { docsOnly, noCheckLabel, scopedCheckProblem } from './scoped-checks.ts';

const PROJECT = ['pnpm test', 'pnpm typecheck'];

describe('scopedCheckProblem', () => {
  it.each([
    'pnpm vitest run apps/server/src/persistence/tags.test.ts',
    'pnpm --filter @spark-outpost/web typecheck',
    'npx tsc -p apps/web/tsconfig.json --noEmit',
    'pytest tests/test_tags.py',
  ])('accepts %s', (command) => {
    expect(scopedCheckProblem(command, PROJECT)).toBeNull();
  });

  it.each([
    ['pnpm test', /whole-project check/],
    ['pnpm check', /runs the whole project/],
    ['pnpm install', /installs packages/],
    ['npx prettier --write apps/web/src/a.ts', /changes files/],
    ['pnpm vitest run', /names no path or package/],
    ['rm -rf src/tags', /runs `rm`, which is not a test runner/],
  ])('refuses %s', (command, problem) => {
    expect(scopedCheckProblem(command, PROJECT)).toMatch(problem);
  });

  it.each([
    `node -e "import('./src/initials.ts').then(m=>{if(m.initials('Ada Lovelace')!=='AL')process.exit(1)})"`,
    'node -e "require(\'./src/initials.js\')"',
    'node --input-type=module -e "import(`../lib/slug.mjs`)"',
    'python3 -c "import runpy; runpy.run_path(\'tests/test_tags.py\')"',
  ])('accepts a file named inside quotes or brackets: %s', (command) => {
    expect(scopedCheckProblem(command, ['npm test'])).toBeNull();
  });

  it.each([
    ['npm test', /whole-project check/],
    ['node --test', /names no path or package/],
    ['node -e "console.log(1/2)"', /names no path or package/],
    ["node -e \"process.exit(require('node:fs').existsSync('x') ? 0 : 1)\"", /names no path/],
    ['npm run test -- --reporter="dot"', /names no path or package/],
  ])('still refuses a command that names no file: %s', (command, problem) => {
    expect(scopedCheckProblem(command, ['npm test'])).toMatch(problem);
  });
});

describe('docsOnly', () => {
  it('holds when every owned file is docs or text', () => {
    expect(docsOnly(['README.md'])).toBe(true);
    expect(docsOnly(['docs/guide.mdx', 'docs/**/*.md', 'NOTES.txt', 'CHANGELOG'])).toBe(true);
  });

  it('fails for code, mixed or empty ownership', () => {
    expect(docsOnly(['README.md', 'src/index.ts'])).toBe(false);
    expect(docsOnly(['src/readme.ts'])).toBe(false);
    expect(docsOnly([])).toBe(false);
  });
});

describe('noCheckLabel', () => {
  it('says why a piece has no scoped check', () => {
    expect(noCheckLabel(['README.md', 'docs/guide.md'])).toBe('none — docs only');
    expect(noCheckLabel(['migrations/002_upload_tags.sql'])).toBe(
      'none — migration; full checks run after landing',
    );
    expect(noCheckLabel(['db/schema.sql'])).toBe('none — migration; full checks run after landing');
    expect(noCheckLabel(['migrations/002.sql', 'src/slug.ts'])).toBe('none');
    expect(noCheckLabel([])).toBe('none');
  });
});
