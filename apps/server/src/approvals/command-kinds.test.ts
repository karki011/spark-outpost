import { describe, expect, it } from 'vitest';
import {
  isPackageInstall,
  isSafeRead,
  TEST_RUNNER_ALLOWLIST,
  type CommandPlace,
} from './command-kinds.ts';
import { decide, NO_RUN_RULES, type ApprovalRequest } from './decide.ts';

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

  it.each([
    'ls .claude/skills/ 2>/dev/null; ls libs/features/budgets libs/features/budgets/src',
    "wc -l docs/project/ARCHITECTURE.md && grep -n '^#' docs/project/ARCHITECTURE.md",
    'ls apps libs libs/* | head -80',
    'ls src >/dev/null 2>&1 || ls lib',
    'cat README.md &>/dev/null',
    'git log --oneline 2>&1 | head -5',
    'cat a.txt | sort | uniq -c | sort -rn | head',
    'ls src | wc -l',
    'grep -n TODO src/index.ts | cut -d: -f1 | tail -3',
    "cat package.json | jq '.scripts'",
    "cat notes.txt | awk '{print $1}' | tr a-z A-Z",
    "cat notes.txt | sed 's/a/b/g'",
    "sed -n '/start/,/end/p' notes.txt",
    'git diff | rg -n TODO',
    'ls src\nls lib',
  ])('allows the compound read %s', (command) => {
    expect(isSafeRead(command, place)).toBe(true);
  });

  it.each([
    ['output to a file', 'ls > out.txt'],
    ['output to a file next to a discarded one', 'ls 2>/dev/null > out.txt'],
    ['appending to a file', 'cat a.txt >> b.txt'],
    ['a path that only starts like /dev/null', 'ls >/dev/nullx'],
    ['an input redirect', 'wc -l < notes.txt'],
    ['a background job', 'ls & rm -rf build'],
    ['a subshell', '(ls)'],
    ['a chain with a write', 'ls; rm x'],
    ['a chain with an unknown program', 'grep -n x a.txt || curl https://example.com'],
    ['a pipe into a shell', 'cat script.txt | sh'],
    ['a pipe into xargs', 'ls | xargs cat'],
    ['tee', 'ls | tee out.txt'],
    ['sort writing a file', 'cat a.txt | sort -o out.txt'],
    ['uniq writing a file', 'uniq a.txt b.txt'],
    ['sed in place in a pipe', 'ls && sed -i s/a/b/ notes.txt'],
    ['sed writing a file', "cat a.txt | sed 's/a/b/w out.txt'"],
    ['sed running a command', "cat a.txt | sed 's/a/b/e'"],
    ['awk running a command', 'cat a.txt | awk \'{system("rm x")}\''],
    ['awk writing a file', 'cat a.txt | awk \'{print > "out.txt"}\''],
    ['awk from a program file', 'awk -f prog.awk a.txt'],
    ['ripgrep with a preprocessor', 'cat a.txt | rg --pre ./run KEY'],
    ['ripgrep searching paths', 'cat a.txt | rg KEY src'],
    ['a variable', 'ls "$HOME"'],
    ['a read outside the project in a pipe', 'cat /etc/hosts | head'],
    ['an unterminated quote', "ls 'src"],
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

describe('test runners at Automatic (N4)', () => {
  const run = (command: string): ApprovalRequest => ({
    toolCallId: 't1',
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title: command,
    command,
    cwd: ROOT,
    paths: [],
    diffs: [],
    options: [],
    roots: [{ path: ROOT, ignore: [] }],
    home: '/Users/me',
  });

  it.each(['node --test', 'node --test test/math.test.js', 'pnpm test', 'npm test', 'pytest -q'])(
    'runs %s without asking',
    (command) => {
      expect(decide('edits', run(command), NO_RUN_RULES, TEST_RUNNER_ALLOWLIST)).toEqual({
        verdict: 'allow',
        by: 'allowlist',
      });
    },
  );

  it('still asks for chained commands and installs', () => {
    expect(
      decide('edits', run('node --test && rm -rf dist'), NO_RUN_RULES, TEST_RUNNER_ALLOWLIST)
        .verdict,
    ).toBe('ask');
    expect(decide('edits', run('npm install'), NO_RUN_RULES, TEST_RUNNER_ALLOWLIST).verdict).toBe(
      'ask',
    );
  });
});
