import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import {
  NO_RUN_RULES,
  SAFE_READ_WHY,
  UNREADABLE_REASON,
  decide,
  type ApprovalRequest,
  type DecideOptions,
} from './decide.ts';
import { ASK_RUN_REASON } from './ask-run.ts';
import type { FileLister } from './file-lister.ts';
import { parseShell } from './shell-parse.ts';

const ROOT = '/work/app';
const noFiles: FileLister = { glob: () => [], walk: () => [], script: () => null };

function run(command: string, extra: Partial<ApprovalRequest> = {}): ApprovalRequest {
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
    ...extra,
  };
}

async function decideParsed(
  posture: ModePosture,
  command: string,
  options: DecideOptions = {},
  extra: Partial<ApprovalRequest> = {},
) {
  const shell = await parseShell(command);
  return decide(posture, run(command, extra), NO_RUN_RULES, [], {
    files: noFiles,
    ...options,
    shell,
  });
}

const LOOP_READ = [
  `for r in $(git branch -r --format='%(refname:short)'); do git grep -l -i -E "AI_USER|aiUser" "$r" -- libs apps 2>/dev/null | sed "s|^|$r → |"; done | sort -u | head -20`,
  'echo "== fetch age"',
  'ls -la "$(git rev-parse --git-common-dir)/FETCH_HEAD"',
  'sed -n 1,40p apps/web/src/__mocks__/handlers.ts',
  'git show origin/main:apps/web/src/config/navigation-registry.ts | sed -n 155,170p',
].join('; ');

describe('decide() reads shell commands it parses', () => {
  it('proves a looping, substituting read-only command reads only', async () => {
    expect(await decideParsed('asks', LOOP_READ)).toEqual({
      verdict: 'allow',
      by: 'level',
      why: SAFE_READ_WHY,
    });
  });

  it.each([
    'cat "$(git rev-parse --show-toplevel)/.env"',
    'for f in a b; do echo "$f" > notes.txt; done',
    'sed -i "" s/a/b/ README.md',
    'rg --hidden TOKEN',
    'f() { ls; }; f',
  ])('does not call %s read-only', async (command) => {
    expect((await decideParsed('asks', command)).verdict).toBe('ask');
  });

  it('reads a committed secret file like any other file', async () => {
    expect(await decideParsed('asks', 'git show HEAD:.env')).toEqual({
      verdict: 'allow',
      by: 'level',
      why: SAFE_READ_WHY,
    });
  });

  it('asks before a redirect writes outside the project, but not into a temp folder', async () => {
    expect(await decideParsed('full_access', 'git log > ~/log.txt')).toEqual({
      verdict: 'ask',
      reason: expect.stringMatching(
        /^(?:This changes .+, which is outside this project|Changing files outside the repo always asks)$/,
      ),
      outsideWrite: true,
    });
    expect(await decideParsed('full_access', 'git log > /tmp/log.txt')).toEqual({
      verdict: 'allow',
      by: 'level',
    });
  });

  it('asks before a command copies files out of the project', () => {
    expect(decide('auto', run('cp src/a.ts ~/Desktop/a.ts'), NO_RUN_RULES, [])).toEqual({
      verdict: 'ask',
      reason: expect.stringMatching(
        /^(?:This changes .+, which is outside this project|Changing files outside the repo always asks)$/,
      ),
      outsideWrite: true,
    });
  });
});

describe('decide() in a read-only run', () => {
  const asking = { askRun: true, askAutoWhy: 'Automatic in an Ask turn' };

  it('runs a parsed read-only command without asking', async () => {
    expect(await decideParsed('read_only', LOOP_READ, asking)).toMatchObject({ verdict: 'allow' });
  });

  it('refuses a write hidden in a loop', async () => {
    expect(await decideParsed('read_only', 'for f in a; do touch "$f"; done', asking)).toEqual({
      verdict: 'reject',
      reason: ASK_RUN_REASON,
    });
  });

  it('asks when it cannot check that the command only reads', async () => {
    expect(await decideParsed('read_only', 'f() { ls; }; f', asking)).toEqual({
      verdict: 'ask',
      reason: UNREADABLE_REASON,
    });
  });
});

describe('decide() when the agent asks on its own', () => {
  it.each(['auto', 'edits', 'asks'] as const)('shows the request in %s', (posture) => {
    const request = run('curl -sI https://example.com', { agentReason: 'needs network' });
    expect(decide(posture, request, NO_RUN_RULES, [], { agentAsks: true })).toEqual({
      verdict: 'ask',
      reason: null,
    });
  });

  it('lets Full access answer it', () => {
    expect(
      decide('full_access', run('curl -sI https://example.com'), NO_RUN_RULES, [], {
        agentAsks: true,
      }),
    ).toEqual({ verdict: 'allow', by: 'level' });
  });
});
