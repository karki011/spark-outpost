import { describe, expect, it } from 'vitest';
import { GIT_CONFIG_ASK_RULE, agentDefinitions } from '../src/agents/acp/agents.ts';
import { CLAUDE_GATED_ASK_RULES } from '../src/agents/acp/claude-tools.ts';
import { decide, NO_RUN_RULES, type ApprovalRequest } from '../src/approvals/decide.ts';
import { railCrossings } from '../src/approvals/rail-crossings.ts';
import { protectedPath } from '../src/projects/path-policy.ts';
import { asksBeforeEditing, sessionAskRules } from './fake-acp-floor.ts';
import { asksBeforeRunning } from './fake-acp-floor-commands.ts';

const ROOT = '/work/app';
const EXTRA = '/work/lib';

const PROTECTED = [
  'AGENTS.md',
  'CLAUDE.md',
  'docs/AGENTS.md',
  'packages/web/CLAUDE.md',
  '.claude/settings.json',
  '.claude/commands/review.md',
  '.cursor/rules/style.mdc',
  '.agents/skills/lint/SKILL.md',
  '.codex/config.toml',
  '.codex/rules/default.rules',
  '.github/copilot-instructions.md',
  '.git/hooks/pre-commit',
  '.git/hooks/pre-push',
  '.git/config',
];

const ORDINARY = [
  'src/app.ts',
  'README.md',
  'docs/agents.md',
  'AGENTS.md.bak',
  'notes/CLAUDE.md.txt',
  '.github/workflows/ci.yml',
  '.cursor/settings.json',
  'package.json',
  '.gitignore',
  '.spark/plans/next.md',
  '.spark/worktrees/chat-1/src/app.ts',
];

const doRules = (extraRoots: string[] = []) =>
  sessionAskRules(agentDefinitions.claude.doSessionMeta?.(extraRoots));
const asks = (rules: string[], root: string, relative: string) =>
  asksBeforeEditing(rules, ROOT, `${root}/${relative}`);

describe('the ask rules Spark gives a Claude session that can change files', () => {
  it('send every instruction file, git hook and git config edit to the approval gate', () => {
    const rules = doRules();
    for (const relative of PROTECTED) {
      expect([relative, protectedPath(relative) !== null]).toEqual([relative, true]);
      expect([relative, asks(rules, ROOT, relative)]).toEqual([relative, true]);
    }
  });

  it('match no ordinary file, plan file or worktree file', () => {
    const rules = doRules();
    for (const relative of ORDINARY) {
      expect([relative, protectedPath(relative)]).toEqual([relative, null]);
      expect([relative, asks(rules, ROOT, relative)]).toEqual([relative, false]);
    }
  });

  it('name paths and one command; only the web and Monitor tools ask whole, for the gate', () => {
    const rules = doRules([EXTRA]);
    const commands = rules.filter((rule) => !rule.startsWith('Edit('));
    expect(commands).toEqual([...CLAUDE_GATED_ASK_RULES, GIT_CONFIG_ASK_RULE]);
    for (const rule of rules.filter((candidate) => candidate.startsWith('Edit('))) {
      expect(rule).toMatch(/^Edit\([^()]*[/.][^()]*\)$/);
    }
  });

  it.each([
    'git config user.email x',
    'git config --global user.email x',
    'git config --get user.email',
    'git config --list',
    'git config',
    'pnpm test && git config user.email x',
    'cd lib; git config core.hooksPath hooks',
    'git config --list | grep user',
  ])('send %s to the approval gate', (command) => {
    expect(asksBeforeRunning(doRules(), command)).toBe(true);
  });

  it.each([
    'git status',
    'git log --oneline -5',
    'git diff',
    'git commit -m x',
    'git commit -m "git config"',
    'git add -A',
    'git checkout -b spark/x',
    'git configure',
    'pnpm vitest run src',
    'ls -la',
    'cat .git/config',
  ])('leave %s to the mode of the agent', (command) => {
    expect(asksBeforeRunning(doRules(), command)).toBe(false);
  });

  it.each([
    'git -C packages/web config user.email x',
    'git --git-dir=.git config user.email x',
    'git -c core.editor=vi config -e',
    '/usr/bin/git config user.email x',
    'sh -c "git config user.email x"',
    'echo x >> .git/config',
  ])('cannot see %s, which is flagged afterwards instead', async (command) => {
    expect(asksBeforeRunning(doRules(), command)).toBe(false);
    const crossings = await railCrossings(commandRequest(command));
    expect(crossings).toContainEqual({ rail: 'git_control', paths: ['.git/config'] });
  });

  it('cover the same paths in every other linked repo', () => {
    const rules = doRules([EXTRA]);
    for (const relative of PROTECTED) {
      expect([relative, asks(rules, EXTRA, relative)]).toEqual([relative, true]);
    }
    for (const relative of ORDINARY) {
      expect([relative, asks(rules, EXTRA, relative)]).toEqual([relative, false]);
    }
  });

  it('are the same for Z.ai and for the chat run that changes a project', () => {
    const plain = doRules().filter((rule) => rule.startsWith('Edit('));
    const edits = (meta: Record<string, unknown> | undefined) =>
      sessionAskRules(meta).filter((rule) => rule.startsWith('Edit('));
    expect(edits(agentDefinitions.zai.doSessionMeta?.([]))).toEqual(plain);
    expect(edits(agentDefinitions.claude.doSessionMeta?.([], null, true))).toEqual(plain);
    expect(sessionAskRules(agentDefinitions.zai.doSessionMeta?.([]))).toEqual(doRules());
  });

  it('give a session only the rules for the tools it has', () => {
    expect(sessionAskRules(agentDefinitions.claude.conversationSessionMeta?.())).toEqual([]);
    expect(sessionAskRules(agentDefinitions.claude.projectSessionMeta?.([]))).toEqual([]);
    expect(
      sessionAskRules(agentDefinitions.claude.projectSessionMeta?.([], null, true, true)),
    ).toEqual([...CLAUDE_GATED_ASK_RULES, GIT_CONFIG_ASK_RULE]);
  });

  it('leave .spark to the flag after the fact, since a glob there would also catch plan files', () => {
    expect(protectedPath('.spark/notes.md')).toBe('instructions');
    expect(asks(doRules(), ROOT, '.spark/notes.md')).toBe(false);
  });
});

const REQUEST = {
  toolCallId: 't1',
  rpcId: null,
  diffs: [],
  options: [],
  roots: [{ path: ROOT, ignore: [] }],
  home: '/Users/me',
};

function editRequest(relative: string): ApprovalRequest {
  return {
    ...REQUEST,
    kind: 'edit',
    toolKind: 'edit',
    title: `Edit ${relative}`,
    command: null,
    cwd: null,
    paths: [`${ROOT}/${relative}`],
  };
}

function commandRequest(command: string): ApprovalRequest {
  return {
    ...REQUEST,
    kind: 'execute',
    toolKind: 'execute',
    title: command,
    command,
    cwd: ROOT,
    paths: [],
  };
}

describe('what the gate answers once such an edit arrives', () => {
  const NON_ASKING = ['edits', 'auto', 'full_access'] as const;

  it('asks for an instruction file in every mode that would not have asked', () => {
    for (const posture of NON_ASKING) {
      expect(decide(posture, editRequest('AGENTS.md'), NO_RUN_RULES, [])).toMatchObject({
        verdict: 'ask',
        instructionFiles: ['AGENTS.md'],
      });
    }
  });

  it('asks with hold-to-confirm for a git hook and git config', () => {
    for (const posture of NON_ASKING) {
      for (const relative of ['.git/hooks/pre-commit', '.git/config']) {
        expect(decide(posture, editRequest(relative), NO_RUN_RULES, [])).toMatchObject({
          verdict: 'ask',
          gitControl: [relative],
        });
      }
    }
  });
});
