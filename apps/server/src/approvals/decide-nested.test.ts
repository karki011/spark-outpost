import { describe, expect, it } from 'vitest';
import { BUILDER_PUBLISH_REASON, NO_RUN_RULES, decide, type ApprovalRequest } from './decide.ts';
import type { FileLister } from './file-lister.ts';
import { PLAIN_FORCE_REASON } from './git-commands.ts';
import { parseShell } from './shell-parse.ts';

const ROOT = '/work/app';
const noFiles: FileLister = { glob: () => [], walk: () => [], script: () => null };

function run(command: string): ApprovalRequest {
  return {
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
  };
}

const fullAccess = (command: string) =>
  decide('full_access', run(command), NO_RUN_RULES, [], { files: noFiles });

const parsedFullAccess = async (command: string) =>
  decide('full_access', run(command), NO_RUN_RULES, [], {
    files: noFiles,
    shell: await parseShell(command),
  });

const ASKS_DELETE = {
  verdict: 'ask',
  reason: expect.stringMatching(
    /^(?:This deletes .+, which is outside this project|Deleting outside the repo always asks)$/,
  ),
};
const ASKS_WRITE = {
  verdict: 'ask',
  reason: expect.stringMatching(
    /^(?:This changes .+, which is outside this project|Changing files outside the repo always asks)$/,
  ),
};

describe('decide() looks inside nested and wrapped commands', () => {
  it.each([
    'sh -c "rm -rf /srv/x"',
    "bash -lc 'cd /srv && rm -rf x'",
    'zsh -c "sh -c \'rm -rf /srv/x\'"',
    'eval "rm -rf /srv/x"',
    'find /srv/x -exec rm -rf {} +',
    'find /srv -name x -execdir rm {} \\;',
    'find /srv -delete',
    'nice -n 10 rm -rf /srv/x',
    'timeout 5 rm -rf /srv/x',
    'timeout -s KILL 5 rm -rf /srv/x',
    'env -u HOME FOO=1 rm -rf /srv/x',
    'sudo -u root rm -rf /srv/x',
    'rm -rf "$HOME/x"',
    'sh -c \'rm -rf "$1"\' _ /srv/x',
    'for x in 1; do rm -rf /srv/x; done',
    'if true; then rm -rf /srv/x; fi',
    'rm -rf $(echo /srv/x)',
    'rm -rf /sr`echo v`/x',
  ])('asks before deleting outside the repo: %s', (command) => {
    expect(fullAccess(command)).toEqual(ASKS_DELETE);
  });

  it.each([
    'sh -c "cat .env"',
    "bash -c 'cat ~/.ssh/id_rsa'",
    'eval cat .env',
    'nice cat .env',
    'timeout 5 cat .env',
    'find . -exec cat .env \\;',
  ])('asks before touching a secret file: %s', (command) => {
    expect(fullAccess(command)).toMatchObject({ verdict: 'ask', secretFiles: expect.any(Array) });
  });

  it.each(['find . -name "*.log" | xargs rm', 'ls | xargs -n 1 rm -f'])(
    'asks before deleting files it gets from a pipe: %s',
    (command) => {
      expect(fullAccess(command)).toEqual(ASKS_DELETE);
    },
  );

  it('finds a delete inside a command substitution in quotes', async () => {
    expect(await parsedFullAccess('echo "$(rm -rf /srv/x)"')).toEqual(ASKS_DELETE);
  });

  it.each([
    'sh -c',
    'sh -c "rm -rf \'/tmp/x"',
    'echo rm -rf /tmp | sh',
    'sh -c "sh -c \\"sh -c \'sh -c ls\'\\""',
    '$CMD /tmp/x',
    'env -S "rm -rf /tmp/x"',
    '$(echo rm) -rf /tmp/x',
  ])('leaves a command it cannot read to the mode: %s', async (command) => {
    expect(await parsedFullAccess(command)).toEqual({ verdict: 'allow', by: 'level' });
  });

  it.each(['sh -c "git push -f origin main"', 'if true; then git push -f origin main; fi'])(
    'refuses force pushes hidden in a shell: %s',
    (command) => {
      expect(fullAccess(command)).toEqual({ verdict: 'reject', reason: PLAIN_FORCE_REASON });
    },
  );

  it('asks before a lease force push hidden in a shell', () => {
    expect(fullAccess('sh -c "git push --force-with-lease origin feature"')).toMatchObject({
      verdict: 'ask',
      forcePush: ['feature'],
    });
  });

  it('refuses Builder publishing hidden behind eval or find', () => {
    const hidden = ['eval git push', 'find . -maxdepth 0 -exec gh pr create \\;'];
    for (const command of [...hidden, 'while true; do gh pr create; done']) {
      expect(decide('full_access', run(command), NO_RUN_RULES, [], { builder: true })).toEqual({
        verdict: 'reject',
        reason: BUILDER_PUBLISH_REASON,
      });
    }
  });

  it.each([
    'sh -c "rm -rf build"',
    'bash -c "pnpm test && rm -rf dist"',
    'find src -name "*.tmp" -exec rm {} +',
    'timeout 60 pnpm test',
    'nice -n 5 pnpm build',
    'bash scripts/build.sh',
    'env NODE_ENV=test pnpm test',
  ])('lets ordinary nested commands follow the mode: %s', (command) => {
    expect(fullAccess(command)).toEqual({ verdict: 'allow', by: 'level' });
  });
});

const UNREADABLE_BODY = 'const quoted = (s) => `"${s.replace(/"/g, \'""\')}"`;\nconst it\'s = "odd';

function heredoc(head: string, tail = ''): string {
  return `${head} <<'EOF'\n${UNREADABLE_BODY}\nEOF${tail}`;
}

const inAuto = (command: string) => decide('auto', run(command), NO_RUN_RULES, []);

describe('decide() treats a heredoc written to a file as a normal write', () => {
  it.each([
    heredoc('cat > src/csv-export.ts'),
    heredoc('cat > src/a.ts', `\n${heredoc('cat > test/a.test.ts')}\nnode --test test/a.test.ts`),
    heredoc('cat src/format.ts; cat > src/slug.ts'),
    heredoc('cat >> docs/notes.md'),
  ])('allows it in Auto: %s', (command) => {
    expect(inAuto(command)).toEqual({ verdict: 'allow', by: 'level' });
  });

  it('follows the mode outside a worktree', () => {
    expect(fullAccess(heredoc('cat > src/a.ts'))).toEqual({ verdict: 'allow', by: 'level' });
  });

  it.each([
    heredoc('bash'),
    heredoc('sh -s'),
    heredoc('python3 -'),
    heredoc('node'),
    heredoc('cat > run.sh', '\nbash'),
  ])('lets the text run as code in Auto: %s', (command) => {
    expect(inAuto(command)).toEqual({ verdict: 'allow', by: 'level' });
  });

  it.each([
    heredoc('cat > /etc/hosts'),
    heredoc('cat > ~/.zshrc'),
    heredoc('cat > ../other/file.ts'),
  ])('asks when the text lands outside the project: %s', (command) => {
    expect(inAuto(command)).toEqual(ASKS_WRITE);
  });

  it('follows the mode when the text lands at a variable path', async () => {
    const command = heredoc('cat > "$OUT"');
    const shell = await parseShell(command);
    expect(decide('auto', run(command), NO_RUN_RULES, [], { shell })).toEqual({
      verdict: 'allow',
      by: 'level',
    });
  });

  it('asks when the literal part of a variable path leaves the project', async () => {
    const command = heredoc('cat > "../$OUT"');
    const shell = await parseShell(command);
    expect(decide('auto', run(command), NO_RUN_RULES, [], { shell })).toEqual(ASKS_WRITE);
  });
});
