import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import { NO_RUN_RULES, decide, type ApprovalRequest } from './decide.ts';
import type { FileLister } from './file-lister.ts';
import { recommendedRulesText, userRules } from '../spark-rules/recommended.ts';
import type { SparkRuleContext } from './gh-rules.ts';
import { GH_TOKEN_REASON } from './git-commands.ts';
import type { PublishGrant } from './publish-policy.ts';

const ROOT = '/work/app/.spark/worktrees/chat-1';
const files: FileLister = { glob: () => [], walk: () => [], script: () => null };
const EVERY_MODE: readonly ModePosture[] = ['asks', 'edits', 'unknown', 'auto', 'full_access'];
const ASKED: PublishGrant = { level: 'full-auto', requested: true };

function context(text: string): SparkRuleContext {
  return { rules: userRules(text), once: [] };
}

const NO_RULES = context('{}');
const ALLOWING = context(JSON.stringify({ permissions: { allow: ['Gh(auth)', 'Gh(*)'] } }));
const RECOMMENDED = context(recommendedRulesText());
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
  ])('%s is refused in every mode, whatever the rules say', (command) => {
    for (const rules of [NO_RULES, ALLOWING, RECOMMENDED]) {
      for (const posture of EVERY_MODE) {
        expect(judged(posture, command, rules, [command, 'gh']), posture).toEqual({
          verdict: 'reject',
          reason: GH_TOKEN_REASON,
        });
      }
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
    expect(denied).not.toMatchObject({ reason: GH_TOKEN_REASON });
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
