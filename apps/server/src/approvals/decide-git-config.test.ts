import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import {
  GIT_CONTROL_REASON,
  NO_RUN_RULES,
  SAFE_READ_WHY,
  decide,
  ruleFor,
  type ApprovalRequest,
  type Decision,
} from './decide.ts';
import { GLOBAL_GIT_CONFIG, SYSTEM_GIT_CONFIG } from './git-config.ts';
import { railCrossings } from './rail-crossings.ts';
import { parseShell } from './shell-parse.ts';

const ROOT = '/work/app';
const EVERY_MODE: ModePosture[] = ['asks', 'edits', 'auto', 'full_access', 'denies', 'unknown'];

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
    roots: [{ path: ROOT, ignore: ['private.cfg'] }],
    home: '/Users/me',
  };
}

async function parsed(posture: ModePosture, command: string): Promise<Decision> {
  return decide(posture, run(command), NO_RUN_RULES, [], { shell: await parseShell(command) });
}

const unparsed = (posture: ModePosture, command: string) =>
  decide(posture, run(command), NO_RUN_RULES, []);

const READS = [
  'git config --get user.email',
  'git config --get-all remote.origin.fetch',
  "git config --get-regexp '^remote\\.'",
  'git config --get-urlmatch http https://example.com',
  'git config --list',
  'git config -l',
  'git config --list --show-origin --show-scope',
  'git config user.email',
  'git config --local user.email',
  'git config --global --get user.email',
  'git config --global --list',
  'git config --file .gitmodules --list',
  'git config --type bool core.bare',
  'git config get user.email',
  'git config list',
  'git --no-pager config --list',
  'git config --list | grep user',
  'git config --get user.email 2>/dev/null',
  'git status && git config --get user.email',
];

const WRITES: [string, string[]][] = [
  ['git config user.email x', ['.git/config']],
  ['git config --local core.hooksPath tools/hooks', ['.git/config']],
  ['git config --add remote.origin.fetch x', ['.git/config']],
  ['git config --unset user.email', ['.git/config']],
  ['git config --unset-all user.email', ['.git/config']],
  ['git config --replace-all user.name x', ['.git/config']],
  ['git config --rename-section a b', ['.git/config']],
  ['git config --remove-section a', ['.git/config']],
  ['git config --edit', ['.git/config']],
  ['git config -e', ['.git/config']],
  ['git config set user.name Spark', ['.git/config']],
  ['git config --global user.email x', [GLOBAL_GIT_CONFIG]],
  ['git config --global --unset user.email', [GLOBAL_GIT_CONFIG]],
  ['git config --system core.editor vim', [SYSTEM_GIT_CONFIG]],
  ['git config --file .git/config core.hooksPath /x', ['.git/config']],
  ['git -C . config user.email x', ['.git/config']],
  ['pnpm test && git config user.email x', ['.git/config']],
  [
    'git config user.email x && git config --global user.name y',
    ['.git/config', GLOBAL_GIT_CONFIG],
  ],
  ['git config --get user.email || git config user.email x', ['.git/config']],
];

describe('decide() for a git config command that only reads', () => {
  it.each(READS)('%s raises no card in any mode that runs reads', async (command) => {
    for (const posture of ['asks', 'edits', 'auto', 'full_access', 'unknown'] as const) {
      const decision = await parsed(posture, command);
      expect([posture, decision.verdict]).toEqual([posture, 'allow']);
    }
  });

  it.each(READS)(
    '%s is allowed as a read where the mode would ask for a command',
    async (command) => {
      for (const posture of ['asks', 'edits'] as const) {
        expect(await parsed(posture, command)).toEqual({
          verdict: 'allow',
          by: 'level',
          why: SAFE_READ_WHY,
        });
      }
    },
  );

  it('is recognized without the parsed script too', () => {
    for (const command of ['git config --get user.email', 'git config --list', 'git config -l']) {
      expect(unparsed('asks', command)).toEqual({
        verdict: 'allow',
        by: 'level',
        why: SAFE_READ_WHY,
      });
    }
  });

  it.each(READS)('%s crosses no rail when it ran without a request', async (command) => {
    expect(await railCrossings(run(command), { shell: await parseShell(command) })).toEqual([]);
  });

  it('is an ordinary command, not a read, when a word is computed', async () => {
    for (const command of ['git config --get "$KEY"', 'git config $(cat key)']) {
      expect(await parsed('asks', command)).toEqual({ verdict: 'ask', reason: null });
      expect((await parsed('auto', command)).verdict).toBe('allow');
    }
  });

  it('is not a proven read of a config file outside the project or one in .sparkignore', async () => {
    for (const command of [
      'git config --file /etc/gitconfig --list',
      'git config -f ../other/.git/config --list',
      'git config --file private.cfg --list',
    ]) {
      expect((await parsed('asks', command)).verdict).toBe('ask');
      expect(unparsed('asks', command).verdict).toBe('ask');
    }
  });
});

describe('decide() for a git config command that writes', () => {
  it.each(WRITES)('%s asks to hold in every mode', async (command, files) => {
    const input = run(command);
    const rules = { allow: [ruleFor(input)!], reject: [] };
    for (const posture of EVERY_MODE) {
      const shell = await parseShell(command);
      expect(decide(posture, input, rules, ['git', 'pnpm'], { shell })).toEqual({
        verdict: 'ask',
        reason: GIT_CONTROL_REASON,
        gitControl: files,
      });
    }
  });

  it.each(WRITES)('%s is flagged when it ran without a request', async (command, files) => {
    const crossings = await railCrossings(run(command), { shell: await parseShell(command) });
    expect(crossings).toContainEqual({ rail: 'git_control', paths: files });
  });

  it('follows the mode when it writes an ordinary file of its own', async () => {
    const command = 'git config --file build/tool.cfg a.b c';
    expect(await parsed('asks', command)).toEqual({ verdict: 'ask', reason: null });
    expect((await parsed('auto', command)).verdict).toBe('allow');
  });
});
