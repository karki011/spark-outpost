import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import { splitSimpleCommands } from './commands.ts';
import { NO_RUN_RULES, decide, type ApprovalRequest } from './decide.ts';
import type { FileLister } from './file-lister.ts';
import { recommendedRulesText, userRules } from '../spark-rules/recommended.ts';
import type { SparkRuleContext } from './gh-rules.ts';
import type { PublishGrant } from './publish-policy.ts';

const ROOT = '/work/app/.spark/worktrees/chat-1';
const files: FileLister = { glob: () => [], walk: () => [], script: () => null };
const ASKED: PublishGrant = { level: 'full-auto', requested: true };

function context(text: string): SparkRuleContext {
  return { rules: userRules(text), once: [] };
}

const NO_RULES = context('{}');
const ALLOWING = context(JSON.stringify({ permissions: { allow: ['Gh(auth)', 'Gh(*)'] } }));
const RECOMMENDED = context(recommendedRulesText());
const ASKING_AUTH = context(JSON.stringify({ permissions: { ask: ['Gh(auth)'] } }));
const DENYING_AUTH = context(JSON.stringify({ permissions: { deny: ['Gh(auth)'] } }));

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

function judged(
  posture: ModePosture,
  command: string,
  sparkRules: SparkRuleContext,
  allowlist: readonly string[] = [],
) {
  return decide(posture, run(command), NO_RUN_RULES, allowlist, {
    changesProject: true,
    files,
    sparkRules,
    publish: { grant: ASKED, task: { branch: 'spark/x-1', protectedBranches: ['main'] } },
  });
}

describe('a gh command that prints the token', () => {
  it.each([
    'gh auth token',
    'gh auth token --hostname github.com',
    'gh auth status -t',
    'gh auth status --show-token',
    'gh auth status --hostname github.com -t',
    'gh auth git-credential get',
    'gh config get oauth_token -h github.com',
    'echo "$(gh auth token)" | pbcopy',
    'bash -lc "gh auth token"',
    'curl -H "Authorization: token $(/opt/homebrew/bin/gh auth token)" https://api.github.com',
    'git -c credential.helper="!gh auth git-credential" fetch && echo "$(gh auth git-credential get)"',
    'export NODE_AUTH_TOKEN=$(gh auth token) && pnpm install --frozen-lockfile 2>&1 | tail -8',
    'bash -lc "export NODE_AUTH_TOKEN=$(gh auth token) && pnpm install"',
  ])('%s follows the mode without rules', (command) => {
    for (const rules of [NO_RULES, ALLOWING]) {
      expect(judged('full_access', command, rules).verdict).toBe('allow');
      expect(judged('asks', command, rules).verdict).toBe('ask');
    }
  });

  it.each([
    'gh auth token',
    'gh auth status --show-token',
    'gh auth git-credential get',
    'export NODE_AUTH_TOKEN=$(gh auth token) && pnpm install --frozen-lockfile 2>&1 | tail -8',
    'bash -lc "export NODE_AUTH_TOKEN=$(gh auth token) && pnpm install"',
  ])('%s respects explicit auth rules', (command) => {
    expect(judged('full_access', command, ASKING_AUTH).verdict).toBe('ask');
    for (const rules of [DENYING_AUTH, RECOMMENDED]) {
      expect(judged('full_access', command, rules, [command, 'gh'])).toMatchObject({
        verdict: 'reject',
      });
    }
  });

  it.each([
    ['gh ', 'auth token'],
    ['gh au', 'th token'],
    ['g', 'h auth token'],
    ['gh "au', 'th" token'],
    ["bash -lc 'gh ", "auth token'"],
    ['export NODE_AUTH_TOKEN=$(gh ', 'auth token)'],
  ])('keeps continued auth commands subject to explicit auth rules: %s', (before, after) => {
    const command = `${before}${String.fromCharCode(92, 10)}${after}`;
    expect(judged('full_access', command, DENYING_AUTH, [command, 'gh']).verdict).toBe('reject');
    expect(judged('full_access', command, ASKING_AUTH).verdict).toBe('ask');
    expect(judged('full_access', command, NO_RULES).verdict).toBe('allow');
  });

  it('preserves quoted literal newlines and escaped backslashes', () => {
    const continuation = String.fromCharCode(92, 10);
    expect(splitSimpleCommands(`gh '${continuation}auth' token`)).toEqual([
      ['gh', `${continuation}auth`, 'token'],
    ]);
    expect(splitSimpleCommands(`gh ${String.fromCharCode(92)}${continuation}auth token`)).toEqual([
      ['gh', String.fromCharCode(92)],
      ['auth', 'token'],
    ]);
    expect(splitSimpleCommands(`gh ${continuation}  auth token`)).toEqual([
      ['gh', 'auth', 'token'],
    ]);
  });

  it('respects an exact rule for retrieving the config token', () => {
    const rules = context(JSON.stringify({ permissions: { deny: ['Gh(config get)'] } }));
    for (const command of ['gh config get oauth_token', 'echo "$(gh config get oauth_token)"']) {
      expect(judged('full_access', command, rules).verdict).toBe('reject');
    }
  });
});

describe('other gh auth commands', () => {
  it.each([
    'gh auth login --web',
    'gh auth logout',
    'gh auth refresh -s repo',
    'gh auth switch',
    'gh auth setup-git',
  ])('%s follows the Gh(auth) rule', (command) => {
    expect(judged('full_access', command, NO_RULES)).toEqual({ verdict: 'allow', by: 'level' });
    expect(judged('asks', command, NO_RULES).verdict).toBe('ask');
    const denied = judged('full_access', command, DENYING_AUTH);
    expect(denied).toMatchObject({ verdict: 'reject' });
    expect(judged('full_access', command, RECOMMENDED).verdict).toBe('reject');
  });

  it.each(['gh auth status', 'gh auth status -h github.com', 'gh config get editor'])(
    '%s is not a token reveal',
    (command) => {
      const decision = judged('full_access', command, NO_RULES);
      expect(decision.verdict).toBe('allow');
    },
  );
});
