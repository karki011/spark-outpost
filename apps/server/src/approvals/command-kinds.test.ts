import { describe, expect, it } from 'vitest';
import { isPackageInstall, isSafeRead, type CommandPlace } from './command-kinds.ts';

const ROOT = '/work/app';
const place: CommandPlace = {
  cwd: ROOT,
  home: '/Users/me',
  inside: (target) => target === ROOT || target.startsWith(`${ROOT}/`),
};

describe('isSafeRead', () => {
  it.each([
    'ls',
    'ls -la src',
    'pwd',
    'cat README.md',
    'head -n 20 src/index.ts',
    'tail -5 notes.txt',
    'wc -l src/*.ts',
    'find . -name "*.ts" -maxdepth 3',
    'tree -L 2',
    'grep -n TODO src/index.ts',
    'sed -n 1,40p src/index.ts',
    'git status --short',
    'git diff HEAD~1 -- src',
    'git log --oneline -n 5',
    'git show HEAD',
    'git branch --show-current',
  ])('allows %s', (command) => {
    expect(isSafeRead(command, place)).toBe(true);
  });

  it.each([
    ['a writer', 'echo hi > notes.txt'],
    ['a pipe', 'cat a.txt | tee b.txt'],
    ['a chain', 'ls && rm -rf build'],
    ['a substitution', 'cat $(cat list.txt)'],
    ['an unknown program', 'node -e "1"'],
    ['a program by path', './ls'],
    ['an environment prefix', 'PAGER=evil git log'],
    ['a wrapper', 'env cat README.md'],
    ['a read outside the project', 'cat /etc/hosts'],
    ['a parent path', 'cat ../other/notes.txt'],
    ['the home folder', 'ls ~/Documents'],
    ['a content glob', 'cat .e*'],
    ['find that runs commands', 'find . -exec rm {} ;'],
    ['find that deletes', 'find . -name "*.log" -delete'],
    ['a recursive grep', 'grep -rn KEY .'],
    ['ripgrep, which searches recursively', 'rg KEY'],
    ['sed with a write script', 'sed -n w/tmp/x notes.txt'],
    ['sed in place', 'sed -i s/a/b/ notes.txt'],
    ['git history at a path', 'git show HEAD:.env'],
    ['git writing a file', 'git diff --output=/tmp/x'],
    ['git creating a branch', 'git branch feature'],
    ['git global options', 'git -c core.pager=evil log'],
    ['a git write', 'git commit -m x'],
    ['tree writing a file', 'tree -o out.txt'],
  ])('refuses %s', (_label, command) => {
    expect(isSafeRead(command, place)).toBe(false);
  });

  it('refuses any command when the working directory is outside the project', () => {
    expect(isSafeRead('ls', { ...place, cwd: '/tmp' })).toBe(false);
  });
});

describe('isPackageInstall', () => {
  it.each([
    'npm install left-pad',
    'npm i',
    'npm install',
    'pnpm add zod',
    'pnpm --filter web add zod',
    'pnpm install',
    'pnpm update',
    'yarn',
    'yarn add react',
    'bun add hono',
    'pip install requests',
    'python3 -m pip install -r requirements.txt',
    'uv add httpx',
    'uv pip install httpx',
    'uv sync',
    'cargo add serde',
    'go get example.com/x',
    'brew install jq',
    'sudo apt-get install -y curl',
    'bundle install',
    'gem install rails',
    'poetry add requests',
    'cd web && npm install',
  ])('treats %s as an install', (command) => {
    expect(isPackageInstall(command)).toBe(true);
  });

  it.each([
    'npm ci',
    'npm install --offline',
    'pnpm install --frozen-lockfile',
    'pnpm -r install --offline',
    'yarn install --immutable',
    'yarn --frozen-lockfile',
    'bun install --frozen-lockfile',
    'uv sync --locked',
    'uv sync --frozen',
    'bundle install --frozen',
    'npm test',
    'pnpm run build',
    'yarn test',
    'cargo build',
    'go test ./...',
    'git status',
  ])('does not treat %s as an install', (command) => {
    expect(isPackageInstall(command)).toBe(false);
  });

  it('still asks when a lockfile install also names a package', () => {
    expect(isPackageInstall('pnpm install --frozen-lockfile zod')).toBe(true);
  });
});
