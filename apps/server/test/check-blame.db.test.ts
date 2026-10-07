import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LEFT_FOR_USER, type CheckBody } from '@spark-outpost/contracts';
import { getConversationDetail, sendUserMessage } from '../src/persistence/conversations.ts';
import { UPGRADED_NOTE } from '../src/orchestration/simple-intake.ts';
import { runCommand } from '../src/setup/command.ts';
import { memorySecretStore } from '../src/setup/secrets.ts';
import {
  TRIVIAL,
  artifactBodies,
  assistantReplies,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  setCheckCommands,
  startOrchestrator,
  startScenario,
  type Harness,
  type JevScript,
} from './orchestration-support.ts';
import { FAKE_GH, repoWithRemote, startGitHubStub, type GitHubStub } from './ship-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const OLD_FAILURE = `console.log(' FAIL  libs/dates/src/holidays.test.ts > today is a working day');
console.log(' FAIL  libs/compat/src/node-version.test.ts > reads the flag');
process.exit(1);
`;

const BASE_REPLAYS_A_CACHE = `if (process.cwd().includes('spark-baseline-')) {
  console.log('Nx read the output from the cache instead of running the command for 2 out of 2 tasks.');
  process.exit(0);
}
${OLD_FAILURE}`;

const BROKEN_BY_THE_CHANGE = `import { readFileSync } from 'node:fs';
if (readFileSync('notes.txt', 'utf8').includes('step')) {
  console.log(' FAIL  notes.test.ts > keeps the first line');
  process.exit(1);
}
`;

const TOOL_INSTALL_NEEDS_LOGIN = `console.log('> tools/codegen prepare');
console.log('npm error code E401');
console.log('npm error Incorrect or missing password.');
console.log('filler line\\n'.repeat(2000));
console.log("src/a.ts(1,1): error TS2307: Cannot find module 'codegen'");
process.exit(2);
`;

let t: TestDb;
let root: string;
let store: string;
let harness: Harness | null = null;
let script: JevScript;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);

function commitFiles(cwd: string, files: Record<string, string>): void {
  for (const [file, text] of Object.entries(files)) writeFileSync(join(cwd, file), text);
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-qm', 'checks on the base commit');
}

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  root = await gitRepo();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
  rmSync(store, { recursive: true, force: true });
});

async function members(runId: string) {
  const { rows } = await t.db.query<{ role: string; follow_up: string | null }>(
    `SELECT role, route->>'followUp' AS follow_up FROM runs
     WHERE parent_run_id = $1 ORDER BY created_at`,
    [runId],
  );
  return rows;
}

async function checkRows(conversationId: string) {
  const detail = await getConversationDetail(t.db, conversationId);
  const items = detail?.tasks.flatMap((task) => task.items) ?? [];
  return items.filter((item) => item.label.startsWith('Checks for'));
}

async function begin(files: Record<string, string>, commands: string[]) {
  commitFiles(root, files);
  await setCheckCommands(t, root, commands);
  script = { calls: [], scenario: TRIVIAL };
  harness = startOrchestrator(t, jevFetch(script), { sessions: store });
  const started = await startScenario(t, root, TRIVIAL, 'full-auto');
  const { orchestration } = await driveToEnd(t, started.conversationId, started.runId);
  expect(orchestration.status).toBe('succeeded');
  return started;
}

async function nextTurn(conversationId: string) {
  script.scenario = { ...TRIVIAL, continuesTask: 0.95 };
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: TRIVIAL.text },
    { provider: 'claude', model: 'sonnet', effort: 'medium', permission: 'do', level: 'full-auto' },
  );
  harness!.worker.wake();
  const { orchestration } = await driveToEnd(t, conversationId, sent.run.id);
  expect(orchestration.status).toBe('succeeded');
  return sent.run.id;
}

const bodies = () => artifactBodies<CheckBody>(t, 'check');

describe('a check that already fails on the base commit', { timeout: 120_000 }, () => {
  it('starts no fix round and shows one calm row', async () => {
    const { conversationId, runId } = await begin({ 'check.mjs': OLD_FAILURE }, ['node check.mjs']);
    expect((await members(runId)).map((member) => member.role)).toEqual(['builder']);
    const rounds = await bodies();
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.status).toBe('skipped');
    expect(rounds[0]!.results[0]).toMatchObject({
      cause: 'baseline',
      blamed: [],
      baseline: { outcome: 'failed', trusted: true, cached: false },
    });
    const rows = await checkRows(conversationId);
    expect(rows.map((row) => [row.label, row.state])).toEqual([
      ['Checks for Bolt: node check.mjs already failing before this change', 'done'],
    ]);
  });

  it('stays unknown, with no fix round, when the base run only replayed a cache', async () => {
    const { conversationId, runId } = await begin({ 'check.mjs': BASE_REPLAYS_A_CACHE }, [
      'node check.mjs',
    ]);
    expect((await members(runId)).map((member) => member.role)).toEqual(['builder']);
    const rounds = await bodies();
    expect(rounds.map((body) => body.status)).toEqual(['skipped']);
    expect(rounds[0]!.results[0]).toMatchObject({
      cause: 'unknown',
      blamed: [],
      baseline: { outcome: 'passed', trusted: false },
    });
    const rows = await checkRows(conversationId);
    expect(rows.map((row) => [row.label, row.state])).toEqual([
      ["Checks for Bolt: node check.mjs failed before this change or can't tell", 'done'],
    ]);
    expect(rows[0]!.output).toContain('not relied on');
  });

  it('reports a registry login deep in the output as could not run, with the advice once', async () => {
    const { runId } = await begin({ 'types.mjs': TOOL_INSTALL_NEEDS_LOGIN }, [
      'node types.mjs',
      'node types.mjs --again',
    ]);
    expect((await members(runId)).map((member) => member.role)).toEqual(['builder']);
    const [round] = await bodies();
    expect(round!.status).toBe('skipped');
    expect(round!.results.map((result) => result.cause)).toEqual(['environment', 'environment']);
    expect(round!.results[0]!.note).toContain('Run `npm login`');
    expect(round!.results[1]!.note).toBe('Same setup problem as the check above.');
  });
});

describe('a check the change broke', { timeout: 180_000 }, () => {
  it('gets one fix round, then one upgrade to a build when the failing set is unchanged, and is not sent again next turn', async () => {
    const { conversationId, runId } = await begin({ 'check.mjs': BROKEN_BY_THE_CHANGE }, [
      'node check.mjs',
    ]);
    const first = await members(runId);
    expect(first.map((member) => member.role)).toEqual(['builder', 'builder', 'builder']);
    expect(first[1]!.follow_up).toContain('## Failing checks');
    expect(first[2]!.follow_up).toContain('## Failing checks');
    expect((await assistantReplies(t, runId)).join('\n')).toContain(UPGRADED_NOTE);
    const rounds = await bodies();
    expect(rounds.map((body) => [body.status, body.leftForUser ?? false])).toEqual([
      ['failed', false],
      ['failed', true],
      ['failed', true],
    ]);
    expect(rounds[0]!.results[0]).toMatchObject({
      cause: 'change',
      blamed: ['test notes.test.ts'],
      baseline: { outcome: 'passed', trusted: true },
    });
    const rows = await checkRows(conversationId);
    expect(rows.at(-1)!.label).toBe(`Checks for Bolt: node check.mjs failed · ${LEFT_FOR_USER}`);

    const second = await nextTurn(conversationId);
    const later = await members(second);
    expect(later.filter((member) => member.follow_up?.includes('## Failing checks'))).toEqual([]);
    const after = (await bodies()).slice(rounds.length);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((body) => body.status === 'failed' && body.leftForUser === true)).toBe(true);
  });
});

describe('publishing with a failure the change did not cause', { timeout: 180_000 }, () => {
  let base: string;
  let stub: GitHubStub;

  beforeEach(async () => {
    base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-check-blame-')));
    process.env.FAKE_GH_NODE = process.execPath;
    process.env.FAKE_GH_STATE = path.join(base, 'gh-state');
    await writeFile(path.join(base, 'gh-state'), 'octo-cli');
    stub = await startGitHubStub();
    process.env.FAKE_GH_API = stub.url;
  });

  afterEach(async () => {
    await stub.close();
    await rm(base, { recursive: true, force: true });
  });

  it('opens a ready pull request without a "Checks failing" title and states the fact in the body', async () => {
    const repo = await repoWithRemote(base, 'old-failure');
    commitFiles(repo.root, { 'check.mjs': OLD_FAILURE });
    git(repo.root, 'push', '-q', 'origin', 'main');
    await setCheckCommands(t, repo.root, ['node check.mjs']);
    harness = startOrchestrator(t, jevFetch({ calls: [], scenario: TRIVIAL }), {
      shipAccess: {
        secrets: memorySecretStore(),
        runCommand,
        fetch,
        apiUrl: stub.url,
        locateGh: async () => FAKE_GH,
      },
    });
    const started = await startScenario(t, repo.root, TRIVIAL, 'full-auto');
    const { orchestration } = await driveToEnd(
      t,
      started.conversationId,
      started.runId,
      undefined,
      90_000,
    );
    expect(orchestration.status).toBe('succeeded');
    const turns = await members(started.runId);
    expect(turns.filter((member) => member.follow_up?.includes('## Failing checks'))).toEqual([]);
    const publish = turns.find((member) => member.follow_up?.startsWith('## Publish this change'));
    expect(publish?.follow_up).not.toContain('Checks failing');
    expect(publish?.follow_up).not.toContain('--draft');
    expect(publish?.follow_up).not.toContain('own run failed');
    expect(publish?.follow_up).toContain('do not make the pull request a draft');
    expect(publish?.follow_up).toContain(
      '`node check.mjs` fails without this change as well (test libs/compat/src/node-version.test.ts, test libs/dates/src/holidays.test.ts); this change did not cause it.',
    );
    expect(stub.github.pulls).toHaveLength(1);
    expect(stub.github.pulls[0]!.draft).toBe(false);
    expect(stub.github.pulls[0]!.title).not.toContain('Checks failing');
  });
});
