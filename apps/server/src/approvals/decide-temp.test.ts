import { mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import { NO_RUN_RULES, decide, type ApprovalRequest, type DecideOptions } from './decide.ts';
import { OUTSIDE_DELETE_REASON, OUTSIDE_WRITE_REASON } from './rails.ts';
import { parseShell } from './shell-parse.ts';
import { inTempDir, tempRoots } from './temp-dirs.ts';

const ROOT = '/work/app';
const HOME = '/Users/me';
const NO_FILES = { glob: () => [], walk: () => [], script: () => null };
const MODES: ModePosture[] = ['asks', 'auto', 'full_access'];
const FOLLOWS_MODE = ['ask (the mode asks)', 'allow', 'allow'];

function request(overrides: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: 'execute',
    toolKind: 'execute',
    title: 'run',
    command: null,
    cwd: ROOT,
    paths: [],
    diffs: [],
    options: [],
    roots: [{ path: ROOT, ignore: [] }],
    home: HOME,
    ...overrides,
  };
}

function shown(decision: ReturnType<typeof decide>): string {
  if (decision.verdict === 'allow') return 'allow';
  if (decision.verdict === 'reject') return `refuse (${decision.reason})`;
  return `ask (${decision.reason ?? 'the mode asks'})`;
}

async function verdicts(command: string, options: DecideOptions = {}): Promise<string[]> {
  const shell = await parseShell(command);
  return MODES.map((posture) =>
    shown(
      decide(posture, request({ command, title: command }), NO_RUN_RULES, [], {
        ...options,
        files: NO_FILES,
        shell,
      }),
    ),
  );
}

const always = (reason: string) => MODES.map(() => `ask (${reason})`);
const deletes = (target: string) => always(`This deletes ${target}, which is outside this project`);
const changes = (target: string) => always(`This changes ${target}, which is outside this project`);

describe('temp folders are scratch space', () => {
  it.each([
    'mkdir /tmp/x && echo hi > /tmp/x/a',
    'rm -rf /tmp/x',
    'rm -rf /private/tmp/x /var/tmp/y',
    'rm -rf /tmp/cp48991-*',
    'cd /tmp/x && rm -rf build',
    'find /tmp/x -name "*.log" -delete',
    'rm -rf "$TMPDIR/x"',
    'rm -rf ${TMPDIR}/x && echo hi > $TMPDIR/out.txt',
    'git log --oneline -3; git worktree add -q /tmp/x 265e3aa17 && cd /tmp/x && pnpm test; cd -; git worktree remove /tmp/x',
    'git worktree add /tmp/x 265e3aa17 && cd /tmp/x && ls; cd -; rm -rf /tmp/x; git worktree prune',
  ])('follows the agent mode for %s', async (command) => {
    expect(await verdicts(command)).toEqual(FOLLOWS_MODE);
    expect(await verdicts(command, { changesProject: true })).toEqual(FOLLOWS_MODE);
  });

  it('follows the agent mode for an edit or a delete of a temp file', () => {
    for (const toolKind of ['edit', 'delete']) {
      const asked = request({ kind: 'edit', toolKind, paths: ['/tmp/scratch.txt'] });
      expect(MODES.map((posture) => shown(decide(posture, asked, NO_RUN_RULES, [])))).toEqual(
        FOLLOWS_MODE,
      );
    }
  });

  it.each([
    ['rm -rf /tmp', deletes('/tmp')],
    ['rm -rf /tmp/', deletes('/tmp')],
    ['rm -rf /tmp/*', deletes('/tmp')],
    ['rm -rf /var/tmp', deletes('/var/tmp')],
    ['rm -rf /tmp/x ~/notes', deletes('~/notes')],
    ['rm -rf /tmp/x/../../etc', deletes('/etc')],
    ['rm -rf ~/Library/x', deletes('~/Library/x')],
    ['rm -rf /var/folders/zz/other', deletes('/var/folders/zz/other')],
    ['rm -rf $TMPDIR', deletes(tmpdir())],
    ['rm -rf $TMPDIR/*', deletes(tmpdir())],
    ['rm -rf "$SCRATCH/x"', always(OUTSIDE_DELETE_REASON)],
    ['rm -rf /tmp/$NAME', always(OUTSIDE_DELETE_REASON)],
    ['cd "$SCRATCH" && rm -rf build', always(OUTSIDE_DELETE_REASON)],
    ['ls /tmp | xargs rm -rf', always(OUTSIDE_DELETE_REASON)],
    ['git worktree add ~/elsewhere 265e3aa17', changes('~/elsewhere')],
    ['git worktree add ../sibling 265e3aa17', changes('/work/sibling')],
    ['git worktree add "$SCRATCH" 265e3aa17', always(OUTSIDE_WRITE_REASON)],
    ['git worktree remove ~/elsewhere', deletes('~/elsewhere')],
    ['echo x > /tmp/x/deploy.pem', always('This changes /tmp/x/deploy.pem, a secret file')],
  ])('still asks in every mode for %s', async (command, expected) => {
    expect(await verdicts(command)).toEqual(expected);
  });

  it('follows the agent mode for reading a secret file in a temp folder', async () => {
    expect(await verdicts('cat /tmp/x/.env')).toEqual(FOLLOWS_MODE);
  });

  it('no longer asks about deletes because of a cd it cannot follow', async () => {
    expect(await verdicts('cd "$SCRATCH" && ls; cd -; rm -rf /work/app/build')).toEqual(
      FOLLOWS_MODE,
    );
  });
});

describe('a link out of a temp folder', () => {
  let scratch: string;
  let outside: string;

  beforeAll(async () => {
    scratch = await mkdtemp(path.join(tmpdir(), 'spark-temp-rail-'));
    outside = await realpath(process.cwd());
    await symlink(outside, path.join(scratch, 'link'));
  });

  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('counts by where the link leads', async () => {
    expect(inTempDir(path.join(scratch, 'plain', 'file.txt'))).toBe(true);
    expect(inTempDir(path.join(scratch, 'link', 'file.txt'))).toBe(false);
    expect(await verdicts(`rm -rf ${scratch}/link/dist`)).toEqual(
      deletes(path.join(scratch, 'link', 'dist')),
    );
    expect(await verdicts(`echo x > ${scratch}/link/notes.txt`)).toEqual(
      changes(path.join(scratch, 'link', 'notes.txt')),
    );
    expect(await verdicts(`rm -rf ${scratch}/plain`)).toEqual(FOLLOWS_MODE);
  });

  it('names only the documented temp folders', () => {
    const roots = tempRoots({ TMPDIR: '/' });
    expect(roots).toEqual(expect.arrayContaining(['/tmp', '/private/tmp', '/var/tmp', tmpdir()]));
    expect(roots).not.toContain('/');
    expect(roots).not.toContain('/var/folders');
    expect(inTempDir(HOME)).toBe(false);
    expect(inTempDir(tmpdir())).toBe(false);
  });
});
