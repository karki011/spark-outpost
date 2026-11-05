import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { openProject, sessionMeta } from '../src/agents/acp/session-start.ts';
import {
  decide,
  GIT_CONTROL_REASON,
  NO_RUN_RULES,
  type ApprovalRequest,
} from '../src/approvals/decide.ts';
import type { PathPolicy } from '../src/projects/path-policy.ts';
import { asksBeforeEditing, sessionAskRules } from './fake-acp-floor.ts';

let repo: string;
let other: string;
let worktree: string;

function newRepo(prefix: string): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', folder, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  return folder;
}

beforeAll(() => {
  repo = newRepo('spark-floor-repo-');
  other = newRepo('spark-floor-other-');
  worktree = join(repo, '.spark', 'worktrees', 'chat-1');
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'spark/chat-1', worktree]);
  const linked = join(other, '.spark', 'worktrees', 'chat-1');
  execFileSync('git', ['-C', other, 'worktree', 'add', '-q', '-b', 'spark/chat-1', linked]);
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(other, { recursive: true, force: true });
});

const claude = agentDefinitions.claude;
const turn = { changesProject: true, planning: false };

async function session(roots: string[]): Promise<{ policy: PathPolicy; rules: string[] }> {
  const policy = await openProject(claude, roots);
  return { policy, rules: sessionAskRules(sessionMeta(claude, policy, true, null, turn)) };
}

const GIT_FILES = ['.git/hooks/pre-commit', '.git/hooks/pre-push', '.git/config'];
const NOT_GUARDED = ['.git/HEAD', '.git/info/exclude', 'notes.txt', 'src/app.ts'];

describe('the ask rules of a Claude session that works in a worktree', () => {
  it('send a hook and git config in the real git folder to the approval gate', async () => {
    const { rules } = await session([worktree]);
    for (const file of GIT_FILES) {
      expect([file, asksBeforeEditing(rules, worktree, join(repo, file))]).toEqual([file, true]);
    }
  });

  it("send the worktree's own config to the approval gate", async () => {
    const { rules } = await session([worktree]);
    const own = join(repo, '.git', 'worktrees', 'chat-1', 'config.worktree');
    expect(asksBeforeEditing(rules, worktree, own)).toBe(true);
  });

  it('match nothing else in the real git folder, the checkout or the worktree', async () => {
    const { rules } = await session([worktree]);
    for (const file of NOT_GUARDED) {
      expect([file, asksBeforeEditing(rules, worktree, join(repo, file))]).toEqual([file, false]);
      expect([file, asksBeforeEditing(rules, worktree, join(worktree, file))]).toEqual([
        file,
        false,
      ]);
    }
  });

  it('cover the real git folder of every other linked repo that is a worktree', async () => {
    const linked = join(other, '.spark', 'worktrees', 'chat-1');
    const { rules } = await session([worktree, linked]);
    for (const file of GIT_FILES) {
      expect([file, asksBeforeEditing(rules, worktree, join(other, file))]).toEqual([file, true]);
    }
  });

  it('write every rule for a path outside the folder as an absolute path', async () => {
    const { rules } = await session([worktree]);
    const outside = rules.filter((rule) => rule.includes(join(repo, '.git')));
    expect(outside).toEqual([
      `Edit(/${join(repo, '.git', 'hooks', '*')})`,
      `Edit(/${join(repo, '.git', 'config')})`,
      `Edit(/${join(repo, '.git', 'worktrees', 'chat-1', 'config.worktree')})`,
    ]);
  });
});

describe('the ask rules of a Claude session that works in the checkout', () => {
  it('are the folder-relative rules and nothing more', async () => {
    const { rules } = await session([repo]);
    expect(rules).toEqual(sessionAskRules(claude.doSessionMeta?.([], null, true)));
    for (const file of GIT_FILES) {
      expect([file, asksBeforeEditing(rules, repo, join(repo, file))]).toEqual([file, true]);
    }
  });
});

describe('what the gate answers when an edit in the real git folder arrives', () => {
  const NON_ASKING = ['edits', 'auto', 'full_access'] as const;

  async function edit(target: string): Promise<ApprovalRequest> {
    const { policy } = await session([worktree]);
    return {
      toolCallId: 't1',
      rpcId: null,
      kind: 'edit',
      toolKind: 'edit',
      title: `Write ${target}`,
      command: null,
      cwd: null,
      paths: [target],
      diffs: [],
      options: [],
      roots: policy.roots,
      home: '/Users/me',
    };
  }

  it('asks with hold-to-confirm for a hook and for git config in every mode', async () => {
    for (const posture of NON_ASKING) {
      for (const file of ['.git/hooks/pre-commit', '.git/config']) {
        const decision = decide(posture, await edit(join(repo, file)), NO_RUN_RULES, []);
        expect([posture, decision]).toEqual([
          posture,
          { verdict: 'ask', reason: GIT_CONTROL_REASON, gitControl: [file] },
        ]);
      }
    }
  });

  it("asks the same way for the worktree's own config", async () => {
    const own = join(repo, '.git', 'worktrees', 'chat-1', 'config.worktree');
    expect(decide('full_access', await edit(own), NO_RUN_RULES, [])).toMatchObject({
      verdict: 'ask',
      gitControl: ['.git/config.worktree'],
    });
  });

  it('leaves an ordinary edit in the worktree to the mode', async () => {
    const decision = decide('edits', await edit(join(worktree, 'notes.txt')), NO_RUN_RULES, []);
    expect(decision).toEqual({ verdict: 'allow', by: 'level' });
  });

  it('reads a command that writes the real hook the same way', async () => {
    const { policy } = await session([worktree]);
    const command = `printf 'exit 0' > ${join(repo, '.git/hooks/pre-push')}`;
    const request: ApprovalRequest = {
      ...(await edit(worktree)),
      kind: 'execute',
      toolKind: 'execute',
      title: command,
      command,
      cwd: worktree,
      paths: [],
      roots: policy.roots,
    };
    expect(decide('auto', request, NO_RUN_RULES, [])).toMatchObject({
      verdict: 'ask',
      gitControl: ['.git/hooks/pre-push'],
    });
  });
});
