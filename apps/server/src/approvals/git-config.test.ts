import { describe, expect, it } from 'vitest';
import { gitConfigUses } from './git-commands.ts';
import { GLOBAL_GIT_CONFIG, REPO_GIT_CONFIG, SYSTEM_GIT_CONFIG } from './git-config.ts';

const READ = 'read';
const repo = `write ${REPO_GIT_CONFIG}`;
const global = `write ${GLOBAL_GIT_CONFIG}`;
const system = `write ${SYSTEM_GIT_CONFIG}`;
const file = (name: string) => `write file ${name}`;

function classified(command: string): string[] {
  return gitConfigUses(command).map((use) => {
    if (!use.writes) return READ;
    if (use.where === 'file') return file(use.file ?? '');
    if (use.where === 'global') return global;
    if (use.where === 'system') return system;
    return use.where === 'blob' ? 'write blob' : repo;
  });
}

const TABLE: [string, string[]][] = [
  ['git config --get user.email', [READ]],
  ['git config --get-all remote.origin.fetch', [READ]],
  ["git config --get-regexp '^remote\\..*\\.url$'", [READ]],
  ['git config --get-urlmatch http https://example.com', [READ]],
  ['git config --get-color color.diff.new green', [READ]],
  ['git config --get-colorbool color.ui true', [READ]],
  ['git config --list', [READ]],
  ['git config -l', [READ]],
  ['git config --list --show-origin --show-scope', [READ]],
  ['git config --show-origin --get core.editor', [READ]],
  ['git config --show-scope user.name', [READ]],
  ['git config user.email', [READ]],
  ['git config "user.email"', [READ]],
  ['git config --local user.email', [READ]],
  ['git config --global --get user.email', [READ]],
  ['git config --global --list', [READ]],
  ['git config --system -l', [READ]],
  ['git config --file .gitmodules --get submodule.lib.url', [READ]],
  ['git config -f .gitmodules --list', [READ]],
  ['git config --file=.gitmodules --name-only --list', [READ]],
  ['git config --blob HEAD:.gitmodules --list', [READ]],
  ['git config --type bool core.bare', [READ]],
  ['git config --type=bool --get core.bare', [READ]],
  ['git config --bool core.bare', [READ]],
  ['git config --get --default main init.defaultBranch', [READ]],
  ['git config -z --includes --get-regexp alias', [READ]],
  ['git config get user.email', [READ]],
  ['git config get --all --show-names remote.origin.fetch', [READ]],
  ['git config get --value x --fixed-value user.name', [READ]],
  ['git config list --global', [READ]],
  ['git -C packages/web config --get user.email', [READ]],
  ['git --git-dir=.git config --list', [READ]],
  ['git --no-pager config -l', [READ]],
  ['git config', [READ]],
  ['git config user.email x', [repo]],
  ['git config user.name "A B"', [repo]],
  ["git config alias.st 'status -sb'", [repo]],
  ['git config --local core.hooksPath tools/hooks', [repo]],
  ['git config --worktree core.sparseCheckout true', [repo]],
  ['git config --bool core.bare true', [repo]],
  ['git config --type bool core.bare true', [repo]],
  ['git config --add remote.origin.fetch +refs/x:refs/y', [repo]],
  ['git config --replace-all user.name x', [repo]],
  ['git config --unset user.email', [repo]],
  ['git config --unset-all remote.origin.fetch', [repo]],
  ['git config --rename-section old new', [repo]],
  ['git config --remove-section branch.old', [repo]],
  ['git config --edit', [repo]],
  ['git config -e', [repo]],
  ['git config set user.name Spark', [repo]],
  ['git config set --append remote.origin.fetch x', [repo]],
  ['git config unset user.name', [repo]],
  ['git config edit', [repo]],
  ['git config rename-section a b', [repo]],
  ['git config remove-section a', [repo]],
  ['git config --get user.email --unset', [repo]],
  ['git config --frobnicate user.email', [repo]],
  ['git config -lz', [repo]],
  ['git config --global user.email x', [global]],
  ['git config --global --unset user.email', [global]],
  ['git config --global -e', [global]],
  ['git config set --global core.hooksPath /x', [global]],
  ['git config --system core.editor vim', [system]],
  ['git config --file .git/config core.hooksPath /x', [file('.git/config')]],
  ['git config -f other.cfg a.b c', [file('other.cfg')]],
  ['git config --file=other.cfg --add a.b c', [file('other.cfg')]],
  ['git config --blob HEAD:x a.b c', ['write blob']],
  ['git -C packages/web config user.email x', [repo]],
  ['git --git-dir=/x/.git config user.email x', [repo]],
  ['git -c user.name=y config user.email x', [repo]],
  ['pnpm test && git config user.email x', [repo]],
  ['git config --get user.email || git config user.email x', [READ, repo]],
  ['git config --list | grep user', [READ]],
  ['cd lib; git config --global user.name x; git config -l', [global, READ]],
  ['echo $(git config user.email x)', [repo]],
  ['sh -c "git config user.email x"', [repo]],
  ['git status', []],
  ['git commit -m "git config user.email x"', []],
  ['echo git config user.email x', []],
  ['git log --format=%an config a b', []],
];

describe('reading and writing forms of git config', () => {
  it.each(TABLE)('%s', (command, expected) => {
    expect(classified(command)).toEqual(expected);
  });

  it('covers reads, writes, every scope and compound commands', () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(20);
    const outcomes = new Set(TABLE.flatMap(([, expected]) => expected));
    expect([...outcomes].sort()).toEqual(
      [READ, repo, global, system, file('.git/config'), file('other.cfg'), 'write blob'].sort(),
    );
  });
});
