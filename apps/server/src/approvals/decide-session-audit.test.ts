import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import { ASK_RUN_REASON } from './ask-run.ts';
import {
  NO_RUN_RULES,
  SAFE_READ_WHY,
  UNREADABLE_REASON,
  decide,
  type ApprovalRequest,
  type DecideOptions,
} from './decide.ts';
import { parseShell } from './shell-parse.ts';

const ROOT = '/work/app';
const NO_FILES = { glob: () => [], walk: () => [], script: () => null };

const READER_COMMANDS = [
  `git branch -a --list '*48991*' '*leaderboard*' 2>/dev/null | head -20; git log --all --oneline -i --grep="48991" | head -15`,
  `git grep -l "LeaderboardList" $(git for-each-ref --format='%(refname)' refs/heads refs/remotes/origin/main 2>/dev/null | head -50) 2>/dev/null | head -20; echo ---; git log --all --oneline -i --grep="leaderboard" | head -15`,
  `f=$(git grep -l "LeaderboardList" origin/main -- libs/ui | head -1 | sed 's/^origin\\/main://'); echo $f; git show origin/main:$f | sed -n '1,200p' | grep -n "export"`,
];

const BASE = '/tmp/cp48991-base';
const BUILDER_CARDS = [
  `npx vitest run libs/ui/src/leaderboard-list.test.tsx 2>&1 | grep -E "Test Files|Tests " | head; git worktree add -q ${BASE} HEAD 2>&1 | tail -1; cd ${BASE} && ln -s "$OLDPWD/node_modules" node_modules && npx vitest run libs/ui 2>&1 | tail -3; cd "$OLDPWD"; git worktree remove --force ${BASE}`,
  `git log --oneline -3; git worktree add -q ${BASE} 265e3aa17 && cd ${BASE} && ln -s "$OLDPWD/node_modules" node_modules && npx vitest run libs/features/dashboards/api 2>&1 | grep -E "Test Files|Tests "; cd "$OLDPWD"; git worktree remove --force ${BASE}`,
  `grep -E "FAIL|AssertionError|Error:" /tmp/cp48991-test.log | head -20; git worktree add -q ${BASE} 265e3aa17 && cd ${BASE} && ln -s "$OLDPWD/node_modules" node_modules && npx vitest run libs/features 2>&1 | tail -5; cd "$OLDPWD"; rm -rf ${BASE}; git worktree prune`,
];
const SHELL_EDITS = [
  `python3 - <<'EOF'\np='libs/ui/src/list.ts'\ns=open(p).read()\ns=s.replace('a','b')\nopen(p,'w').write(s)\nEOF`,
  `cat > /tmp/new_validator.ts <<'EOF'\nexport const ok = (n: number) => n >= 2;\nEOF`,
  `sed -i '' "s/old/new/" libs/ui/src/list.ts && npx vitest run libs/ui/src/list.test.ts`,
];
const NX_ALL =
  'npx nx run-many --target=test --parallel=3 --output-style=static > /tmp/cp48991-test.log 2>&1; tail -5 /tmp/cp48991-test.log';

const SOLO_BUILDER: DecideOptions = { builder: true };

function request(command: string, noted: boolean): ApprovalRequest {
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
    ...(noted ? { agentReason: 'This command requires approval' } : {}),
  };
}

async function decided(
  posture: ModePosture,
  command: string,
  options: DecideOptions,
  noted = false,
) {
  return decide(posture, request(command, noted), NO_RUN_RULES, [], {
    ...options,
    files: NO_FILES,
    shell: await parseShell(command),
    agentAsks: noted,
  });
}

describe('the Reader commands from the reported session, in a read-only run', () => {
  const reading: DecideOptions = { askRun: true, askAutoWhy: null };

  it.each(READER_COMMANDS)('runs without a card: %s', async (command) => {
    for (const noted of [false, true]) {
      expect(await decided('read_only', command, reading, noted)).toEqual({
        verdict: 'allow',
        by: 'level',
        why: SAFE_READ_WHY,
      });
    }
  });

  it('still refuses a part that writes and asks about a part it cannot read', async () => {
    expect(
      await decided('read_only', `git branch -a --list '*48991*' > branches.txt`, reading),
    ).toEqual({ verdict: 'reject', reason: ASK_RUN_REASON });
    expect((await decided('read_only', 'git branch scratch', reading)).verdict).toBe('ask');
    expect(await decided('read_only', `f() { git branch -a; }; f`, reading)).toEqual({
      verdict: 'ask',
      reason: UNREADABLE_REASON,
    });
    expect((await decided('read_only', `git branch -D '*48991*'`, reading)).verdict).not.toBe(
      'allow',
    );
  });
});

describe('the Builder commands from the reported session', () => {
  it.each([...BUILDER_CARDS, ...SHELL_EDITS, NX_ALL])(
    'follows the agent mode for a Builder working alone: %s',
    async (command) => {
      expect(await decided('auto', command, SOLO_BUILDER)).toEqual({
        verdict: 'allow',
        by: 'level',
      });
      expect(await decided('full_access', command, SOLO_BUILDER)).toEqual({
        verdict: 'allow',
        by: 'level',
      });
      expect(await decided('asks', command, SOLO_BUILDER)).toEqual({
        verdict: 'ask',
        reason: null,
      });
    },
  );
});
