import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import {
  GIT_CONTROL_REASON,
  INSTRUCTION_REASON,
  NO_RUN_RULES,
  decide,
  ruleFor,
  type ApprovalRequest,
} from './decide.ts';

const ROOT = '/work/app';
const EVERY_MODE: ModePosture[] = ['asks', 'edits', 'auto', 'full_access', 'denies', 'unknown'];

function request(overrides: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title: 'ls',
    command: 'ls',
    cwd: ROOT,
    paths: [],
    diffs: [],
    options: [],
    roots: [{ path: ROOT, ignore: [] }],
    home: '/Users/me',
    ...overrides,
  };
}

const edit = (relative: string) =>
  request({
    kind: 'edit',
    toolKind: 'edit',
    title: `Edit ${relative}`,
    command: null,
    paths: [`${ROOT}/${relative}`],
  });
const run = (command: string) => request({ command, title: command });
const allowAll = (input: ApprovalRequest) => ({ allow: [ruleFor(input)!], reject: [] });

describe('decide() for agent instruction files', () => {
  it.each([
    'AGENTS.md',
    'apps/web/CLAUDE.md',
    '.claude/settings.json',
    '.cursor/rules/style.mdc',
    '.github/copilot-instructions.md',
    '.spark/notes.md',
  ])('asks before editing %s at every level, even with an edit rule for the run', (relative) => {
    const input = edit(relative);
    for (const mode of EVERY_MODE) {
      expect(decide(mode, input, allowAll(input), [])).toEqual({
        verdict: 'ask',
        reason: INSTRUCTION_REASON,
        instructionFiles: [relative],
      });
    }
  });

  it.each([
    ['echo "be terse" >> AGENTS.md', ['AGENTS.md']],
    ["sed -i '' 's/a/b/' .claude/settings.json", ['.claude/settings.json']],
    ['cp /tmp/rules.mdc .cursor/rules/rules.mdc', ['.cursor/rules/rules.mdc']],
  ])('asks before the shell write %s', (command, files) => {
    const input = run(command);
    expect(decide('full_access', input, allowAll(input), [command])).toEqual({
      verdict: 'ask',
      reason: INSTRUCTION_REASON,
      instructionFiles: files,
    });
  });

  it('follows the level once the file is allowed for this chat', () => {
    const grants = { instructionGrants: new Set(['AGENTS.md']) };
    expect(decide('edits', edit('AGENTS.md'), NO_RUN_RULES, [], grants).verdict).toBe('allow');
    expect(decide('asks', edit('AGENTS.md'), NO_RUN_RULES, [], grants)).toEqual({
      verdict: 'ask',
      reason: null,
    });
    expect(decide('edits', edit('CLAUDE.md'), NO_RUN_RULES, [], grants).verdict).toBe('ask');
  });

  it.each(['README.md', 'docs/guide/setup.md', 'src/claude.ts'])(
    'treats %s as an ordinary file',
    (relative) => {
      expect(decide('edits', edit(relative), NO_RUN_RULES, []).verdict).toBe('allow');
    },
  );
});

describe('decide() for git hooks and git config', () => {
  it.each([
    [edit('.git/hooks/pre-commit'), ['.git/hooks/pre-commit']],
    [edit('.git/config'), ['.git/config']],
    [run('chmod +x x && cp hook.sh .git/hooks/pre-push'), ['.git/hooks/pre-push']],
    [run('git config core.hooksPath tools/hooks'), ['.git/config']],
    [run('git config set user.name Spark'), ['.git/config']],
    [run('git config --global a.b c'), ['global git config']],
  ])('asks to hold before %#, at every level', (input, files) => {
    for (const mode of EVERY_MODE) {
      expect(decide(mode, input, allowAll(input), ['git', 'cp'])).toEqual({
        verdict: 'ask',
        reason: GIT_CONTROL_REASON,
        gitControl: files,
      });
    }
  });

  it.each(['git config --get user.name', 'git config user.name', 'git config --global a.b'])(
    'leaves %s alone',
    (command) => {
      expect(decide('full_access', run(command), NO_RUN_RULES, []).verdict).toBe('allow');
    },
  );

  it('still refuses the rest of .git', () => {
    expect(decide('full_access', edit('.git/HEAD'), NO_RUN_RULES, [])).toEqual({
      verdict: 'reject',
      reason: "Files inside .git can't be changed",
    });
  });
});
