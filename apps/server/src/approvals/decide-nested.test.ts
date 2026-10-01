import { describe, expect, it } from 'vitest';
import {
  BUILDER_PUBLISH_REASON,
  NESTED_COMMAND_REASON,
  NO_RUN_RULES,
  OUTSIDE_DELETE_REASON,
  SECRET_REASON,
  WORKTREE_AUTO_WHY,
  decide,
  type ApprovalRequest,
} from './decide.ts';
import { PLAIN_FORCE_REASON } from './git-commands.ts';

const ROOT = '/work/app';

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

const fullAccess = (command: string) => decide('full_access', run(command), NO_RUN_RULES, []);

describe('decide() looks inside nested and wrapped commands', () => {
  it.each([
    'sh -c "rm -rf /tmp/x"',
    "bash -lc 'cd /tmp && rm -rf x'",
    'zsh -c "sh -c \'rm -rf /tmp/x\'"',
    'eval "rm -rf /tmp/x"',
    'find /tmp/x -exec rm -rf {} +',
    'find /tmp -name x -execdir rm {} \\;',
    'find /tmp -delete',
    'nice -n 10 rm -rf /tmp/x',
    'timeout 5 rm -rf /tmp/x',
    'timeout -s KILL 5 rm -rf /tmp/x',
    'env -u HOME FOO=1 rm -rf /tmp/x',
    'sudo -u root rm -rf /tmp/x',
    'rm -rf "$HOME/x"',
    'sh -c \'rm -rf "$1"\' _ /tmp/x',
    'for x in 1; do rm -rf /tmp/x; done',
    'if true; then rm -rf /tmp/x; fi',
    'rm -rf $(echo /tmp/x)',
    'rm -rf /tm`echo p`/x',
  ])('asks before deleting outside the repo: %s', (command) => {
    expect(fullAccess(command)).toEqual({ verdict: 'ask', reason: OUTSIDE_DELETE_REASON });
  });

  it.each([
    'sh -c "cat .env"',
    "bash -c 'cat ~/.ssh/id_rsa'",
    'eval cat .env',
    'nice cat .env',
    'timeout 5 cat .env',
    'find . -exec cat .env \\;',
  ])('asks before touching a secret file: %s', (command) => {
    expect(fullAccess(command)).toEqual({ verdict: 'ask', reason: SECRET_REASON });
  });

  it.each([
    'find . -name "*.log" | xargs rm',
    'ls | xargs -n 1 rm -f',
    'sh -c',
    'sh -c "rm -rf \'/tmp/x"',
    'echo rm -rf /tmp | sh',
    'echo "$(rm -rf /tmp/x)"',
    'sh -c "sh -c \\"sh -c \'sh -c ls\'\\""',
    '$CMD /tmp/x',
    'env -S "rm -rf /tmp/x"',
    '$(echo rm) -rf /tmp/x',
  ])('asks when a nested command cannot be read: %s', (command) => {
    expect(fullAccess(command)).toEqual({ verdict: 'ask', reason: NESTED_COMMAND_REASON });
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

const inWorktree = (command: string) =>
  decide('asks', run(command), NO_RUN_RULES, [], { worktreeAuto: true });

describe('decide() treats a heredoc written to a file as a normal write', () => {
  it.each([
    heredoc('cat > src/csv-export.ts'),
    heredoc('cat > src/a.ts', `\n${heredoc('cat > test/a.test.ts')}\nnode --test test/a.test.ts`),
    heredoc('cat src/format.ts; cat > src/slug.ts'),
    heredoc('cat >> docs/notes.md'),
  ])('allows it at Automatic in the worktree: %s', (command) => {
    expect(inWorktree(command)).toEqual({
      verdict: 'allow',
      by: 'level',
      why: WORKTREE_AUTO_WHY,
    });
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
    heredoc('cat > /etc/hosts'),
    heredoc('cat > ~/.zshrc'),
    heredoc('cat > "$OUT"'),
    heredoc('cat > ../other/file.ts'),
  ])('still asks when the text runs as code or lands outside the project: %s', (command) => {
    expect(inWorktree(command)).toEqual({ verdict: 'ask', reason: NESTED_COMMAND_REASON });
  });
});
