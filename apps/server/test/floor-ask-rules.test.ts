import { describe, expect, it } from 'vitest';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import { decide, NO_RUN_RULES, type ApprovalRequest } from '../src/approvals/decide.ts';
import { protectedPath } from '../src/projects/path-policy.ts';
import { asksBeforeEditing, sessionAskRules } from './fake-acp-floor.ts';

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

  it('name paths only: no rule makes a whole tool or a command ask', () => {
    for (const rule of doRules([EXTRA])) expect(rule).toMatch(/^Edit\([^()]*[/.][^()]*\)$/);
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

  it('are the same for Z.ai, a Builder and a piece', () => {
    const plain = doRules();
    const edits = (meta: Record<string, unknown> | undefined) =>
      sessionAskRules(meta).filter((rule) => rule.startsWith('Edit('));
    expect(edits(agentDefinitions.zai.doSessionMeta?.([]))).toEqual(plain);
    expect(edits(agentDefinitions.claude.doSessionMeta?.([], null, true))).toEqual(plain);
    expect(edits(agentDefinitions.claude.doSessionMeta?.([], null, true, true))).toEqual(plain);
  });

  it('are not given to sessions without the Edit tool', () => {
    expect(sessionAskRules(agentDefinitions.claude.conversationSessionMeta?.())).toEqual([]);
    expect(
      sessionAskRules(agentDefinitions.claude.projectSessionMeta?.([], null, true, true)),
    ).toEqual([]);
  });

  it('leave .spark to the flag after the fact, since a glob there would also catch plan files', () => {
    expect(protectedPath('.spark/notes.md')).toBe('instructions');
    expect(asks(doRules(), ROOT, '.spark/notes.md')).toBe(false);
  });
});

function editRequest(relative: string): ApprovalRequest {
  const target = `${ROOT}/${relative}`;
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: 'edit',
    toolKind: 'edit',
    title: `Edit ${relative}`,
    command: null,
    cwd: null,
    paths: [target],
    diffs: [],
    options: [],
    roots: [{ path: ROOT, ignore: [] }],
    home: '/Users/me',
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
