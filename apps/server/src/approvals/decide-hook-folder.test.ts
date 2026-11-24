import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import { RECOMMENDED_RULES, userRules } from '../spark-rules/recommended.ts';
import type { SparkRuleSet } from '../spark-rules/resolve.ts';
import { GIT_CONTROL_REASON, NO_RUN_RULES, decide, type ApprovalRequest } from './decide.ts';
import type { FileLister } from './file-lister.ts';
import { railCrossings } from './rail-crossings.ts';
import { parseShell } from './shell-parse.ts';

const ROOT = '/work/app';
const EVERY_MODE: ModePosture[] = ['asks', 'edits', 'auto', 'full_access', 'denies', 'unknown'];
const files: FileLister = { glob: () => [], walk: () => [], script: () => null };
const RULE_SETS: [string, SparkRuleSet][] = [
  ['the recommended rules', RECOMMENDED_RULES],
  ['no rules file', userRules('{}')],
  ['GitConfig denied', userRules('{"permissions":{"deny":["GitConfig"]}}')],
];
const HOOK_FILE = 'cp pre-commit .git/hooks/pre-commit';
const CONFIG_FILE = 'rm .git/config';

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

async function decided(posture: ModePosture, command: string, rules: SparkRuleSet) {
  const shell = await parseShell(command);
  const options = { shell, files, sparkRules: { rules, once: [] } };
  return decide(posture, run(command), NO_RUN_RULES, [], options);
}

function shape(decision: Awaited<ReturnType<typeof decided>>) {
  const { gitControl, ...rest } = decision as { gitControl?: string[] };
  return { ...rest, holds: gitControl !== undefined };
}

async function crossed(command: string, rules: SparkRuleSet) {
  const crossings = await railCrossings(run(command), { shell: await parseShell(command), rules });
  return crossings.filter((crossing) => crossing.rail === 'git_control');
}

const INTO_HOOKS: [string, string][] = [
  ['cp pre-commit .git/hooks', '.git/hooks'],
  ['cp pre-commit .git/hooks/', '.git/hooks'],
  ['cp -t .git/hooks pre-commit', '.git/hooks'],
  ['cp --target-directory=.git/hooks pre-commit', '.git/hooks'],
  ['mv x .git/hooks/', '.git/hooks'],
  ['install -m 755 pre-commit .git/hooks', '.git/hooks'],
  ['ln -s ../../tools/pre-commit .git/hooks', '.git/hooks'],
  ['ln -s ../../tools/pre-commit .git/hooks/pre-commit', '.git/hooks/pre-commit'],
  ['rsync -a hooks/ .git/hooks/', '.git/hooks'],
  ['tar -xf hooks.tar -C .git/hooks', '.git/hooks'],
  ['tar xzf hooks.tgz --directory=.git/hooks', '.git/hooks'],
  ['dd if=pre-commit of=.git/hooks/pre-commit', '.git/hooks/pre-commit'],
  ['cd .git/hooks && cp ../../pre-commit pre-commit', '.git/hooks/pre-commit'],
  ['cp pre-commit "$(git rev-parse --git-dir)/hooks"', '.git'],
  ['cp pre-commit .git/hook*', '.git'],
];

const REMOVING: [string, string][] = [
  ['rm -rf .git', '.git'],
  ['rm -rf ./.git/', '.git'],
  ['rm -r .git/hooks', '.git/hooks'],
  ['rmdir .git/hooks', '.git/hooks'],
  ['mv .git /tmp/old-git', '.git'],
  ['mv .git/hooks hooks.bak', '.git/hooks'],
  ['find .git/hooks -delete', '.git/hooks'],
  ['cd .git && rm -rf hooks', '.git/hooks'],
  ['rm -rf .git/*', '.git'],
];

const ORDINARY = [
  'cp a.txt b.txt',
  'mv a.txt b.txt',
  'rm -rf build',
  'cp -r src dst',
  'install -m 644 a.txt dist',
  'ln -s ../shared lib',
  'rsync -a src/ dst/',
  'tar -xf deps.tar -C vendor',
  'dd if=a.img of=b.img',
  'rm -rf .git/objects/pack/tmp_pack_1',
  'cp -r .git/hooks backup',
  'tar -cf out.tar -C .git/hooks .',
  'cp x "$D"',
  'bash -c "$X"',
];

describe('decide() for a write into the git hooks folder', () => {
  it.each(INTO_HOOKS)('%s gets the decision of a hook file write', async (command, label) => {
    for (const [, rules] of RULE_SETS) {
      for (const posture of EVERY_MODE) {
        const folder = await decided(posture, command, rules);
        const file = await decided(posture, HOOK_FILE, rules);
        expect([posture, shape(folder)]).toEqual([posture, shape(file)]);
        if ('gitControl' in folder) expect(folder.gitControl).toContain(label);
      }
    }
  });

  it.each(INTO_HOOKS)('%s asks to hold under the recommended rules', async (command, label) => {
    expect(await decided('full_access', command, RECOMMENDED_RULES)).toEqual({
      verdict: 'ask',
      reason: GIT_CONTROL_REASON,
      gitControl: [label],
    });
  });

  it.each(INTO_HOOKS)('%s is flagged only while GitConfig is set', async (command, label) => {
    expect(await crossed(command, RECOMMENDED_RULES)).toEqual([
      { rail: 'git_control', paths: [label] },
    ]);
    expect(await crossed(command, userRules('{}'))).toEqual([]);
  });
});

describe('decide() for deleting or moving the git folder, its hooks or its config', () => {
  it.each(REMOVING)('%s gets the decision of a git config change', async (command, label) => {
    for (const [, rules] of RULE_SETS) {
      for (const posture of EVERY_MODE) {
        const folder = await decided(posture, command, rules);
        const config = await decided(posture, CONFIG_FILE, rules);
        expect([posture, shape(folder)]).toEqual([posture, shape(config)]);
        if ('gitControl' in folder) expect(folder.gitControl).toEqual([label]);
      }
    }
  });

  it.each(REMOVING)('%s is flagged when it ran without a request', async (command, label) => {
    expect(await crossed(command, RECOMMENDED_RULES)).toEqual([
      { rail: 'git_control', paths: [label] },
    ]);
  });
});

describe('decide() for ordinary copies, moves and deletes', () => {
  it.each(ORDINARY)('%s still follows the mode under every rule set', async (command) => {
    for (const [, rules] of RULE_SETS) {
      const asking = await decided('asks', command, rules);
      expect(asking).not.toHaveProperty('gitControl');
      expect(asking.verdict).not.toBe('allow');
      const auto = await decided('auto', command, rules);
      expect(auto.verdict).toBe('allow');
      expect(await crossed(command, rules)).toEqual([]);
    }
  });
});

describe('decide() for reads that find the git folder', () => {
  it.each([
    'ls -la "$(git rev-parse --git-common-dir)/FETCH_HEAD"',
    'for b in $(git branch --format=x); do git log -1 "$b" 2>/dev/null; done; cat .git/HEAD',
  ])('%s raises no git hook card', async (command) => {
    for (const [, rules] of RULE_SETS) {
      expect(await decided('asks', command, rules)).not.toHaveProperty('gitControl');
    }
  });
});

describe("decide() for the hooks folder of a worktree's real git folder", () => {
  const repo = '/work/main';
  const worktree = `${repo}/.spark/worktrees/chat-1`;
  const gitDirs = { common: `${repo}/.git`, own: `${repo}/.git/worktrees/chat-1` };
  const inWorktree = (command: string): ApprovalRequest => ({
    ...run(command),
    cwd: worktree,
    roots: [{ path: worktree, ignore: [], gitDirs }],
  });

  it.each([
    [`cp pre-commit ${repo}/.git/hooks`, '.git/hooks'],
    [`rm -rf ${repo}/.git`, '.git'],
    [`rm -rf ${repo}/.git/worktrees/chat-1`, '.git/config.worktree'],
    ['rm .git', '.git'],
  ])('%s asks to hold under the recommended rules', async (command, label) => {
    const shell = await parseShell(command);
    const options = { shell, files, sparkRules: { rules: RECOMMENDED_RULES, once: [] } };
    expect(decide('full_access', inWorktree(command), NO_RUN_RULES, [], options)).toEqual({
      verdict: 'ask',
      reason: GIT_CONTROL_REASON,
      gitControl: [label],
    });
  });
});
