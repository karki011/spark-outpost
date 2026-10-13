import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../persistence/db.ts';
import type { DepsOptions, DepsPrep } from '../projects/worktree-deps.ts';
import { pendingDir, sessionDeps, type DepsEnded } from './session-deps.ts';

const CHAT = 'chat-1';
const prepared: DepsPrep = {
  method: 'clone',
  durationMs: 1,
  note: null,
  folders: 1,
  lockfileMatched: true,
  stale: false,
};

let main: string;
let copy: string;
let marker: string;

function held() {
  let release: (prep: DepsPrep | null | Error) => void = () => undefined;
  const calls: DepsOptions[] = [];
  const prepare = vi.fn(
    (_main: string, _copy: string, options: DepsOptions) =>
      new Promise<DepsPrep | null>((resolve, reject) => {
        calls.push(options);
        release = (prep) => (prep instanceof Error ? reject(prep) : resolve(prep));
        options.signal?.addEventListener('abort', () => resolve(null));
      }),
  );
  return { prepare, calls, release: (prep: DepsPrep | null | Error) => release(prep) };
}

function watched(prepare: ReturnType<typeof held>['prepare']) {
  const changed = vi.fn();
  const ended: DepsEnded[] = [];
  const deps = sessionDeps({
    prepare,
    changed,
    ended: (result) => ended.push(result),
    now: () => 5,
  });
  return { deps, changed, ended };
}

const db = (rows: { repo_root: string }[]) => ({ query: async () => ({ rows }) }) as unknown as Db;

beforeEach(async () => {
  main = realpathSync(mkdtempSync(join(tmpdir(), 'spark-session-deps-')));
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', main, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
  git('init', '-q', '-b', 'main');
  writeFileSync(join(main, 'package.json'), '{"name":"app"}');
  git('add', '.');
  git('commit', '-qm', 'base');
  copy = join(main, '.spark', 'worktrees', 'one');
  git('worktree', 'add', '--quiet', '-b', 'spark/one', copy);
  marker = (await pendingDir(copy))!;
});

afterEach(() => {
  rmSync(main, { recursive: true, force: true });
});

describe('dependency preparation behind a Terminal session', () => {
  it('shows preparing with the step it is on, then nothing once it is done', async () => {
    const { prepare, calls, release } = held();
    const { deps, changed, ended } = watched(prepare);
    deps.start(CHAT, { main, copy });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(deps.status(CHAT)).toEqual({ state: 'preparing', step: null, note: null });
    expect(existsSync(marker)).toBe(true);
    expect(calls[0]).toMatchObject({ root: main, staging: join(marker, 'staging') });
    calls[0]!.onPhase?.('install');
    expect(deps.status(CHAT)).toEqual({ state: 'preparing', step: 'install', note: null });
    deps.start(CHAT, { main, copy });
    release(prepared);
    await vi.waitFor(() => expect(ended).toHaveLength(1));
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(deps.status(CHAT)).toBeNull();
    expect(existsSync(marker)).toBe(false);
    expect(ended[0]).toEqual({ conversationId: CHAT, outcome: 'prepared', method: 'clone', ms: 0 });
    expect(changed.mock.calls.every(([id]) => id === CHAT)).toBe(true);
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it('keeps the failure wording in the line when installing failed, and is done trying', async () => {
    const { prepare, calls, release } = held();
    const { deps, ended } = watched(prepare);
    deps.start(CHAT, { main, copy });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    release({
      ...prepared,
      method: 'skipped',
      stale: true,
      note: 'Installing them failed: offline.',
    });
    await vi.waitFor(() => expect(ended).toHaveLength(1));
    expect(deps.status(CHAT)).toEqual({
      state: 'failed',
      step: null,
      note: 'Installing them failed: offline.',
    });
    expect(ended[0]).toMatchObject({ outcome: 'failed', method: 'skipped' });
    expect(existsSync(marker)).toBe(false);
  });

  it('says plainly that preparing failed when the step threw, never the error', async () => {
    const { prepare, calls, release } = held();
    const { deps, ended } = watched(prepare);
    deps.start(CHAT, { main, copy });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    release(new Error(`EACCES ${copy}`));
    await vi.waitFor(() => expect(ended).toHaveLength(1));
    expect(deps.status(CHAT)?.note).toBe(
      'Dependencies could not be prepared in this session’s worktree.',
    );
  });

  it('stops the step when asked, clears the line and leaves the work marked unfinished', async () => {
    const { prepare, calls } = held();
    const { deps, ended } = watched(prepare);
    deps.start(CHAT, { main, copy });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    mkdirSync(join(marker, 'staging', '0'));
    await deps.stop(CHAT);
    expect(calls[0]!.signal?.aborted).toBe(true);
    expect(deps.status(CHAT)).toBeNull();
    expect(ended[0]).toMatchObject({ outcome: 'stopped' });
    expect(existsSync(marker)).toBe(true);
    await deps.stop(CHAT);
  });

  it('prepares again on the next start when the last attempt did not finish, from a clean slate', async () => {
    const { prepare, calls, release } = held();
    const { deps, ended } = watched(prepare);
    await deps.resume(db([{ repo_root: main }]), CHAT, copy);
    expect(prepare).not.toHaveBeenCalled();
    mkdirSync(join(marker, 'staging', '0'), { recursive: true });
    await deps.resume(db([]), CHAT, copy);
    expect(prepare).not.toHaveBeenCalled();
    await deps.resume(db([{ repo_root: main }]), CHAT, copy);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(prepare).toHaveBeenCalledWith(main, copy, expect.anything());
    expect(existsSync(join(marker, 'staging', '0'))).toBe(false);
    release(prepared);
    await vi.waitFor(() => expect(ended).toHaveLength(1));
    expect(existsSync(marker)).toBe(false);
  });

  it('does nothing and shows nothing for a folder without package.json', async () => {
    rmSync(join(copy, 'package.json'));
    const { prepare } = held();
    const { deps, changed, ended } = watched(prepare);
    deps.start(CHAT, { main, copy });
    await vi.waitFor(() => expect(ended).toHaveLength(1));
    expect(ended[0]).toMatchObject({ outcome: 'nothing', method: null });
    expect(prepare).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it('stops every running step when Spark quits', async () => {
    const { prepare, calls } = held();
    const { deps, ended } = watched(prepare);
    deps.start(CHAT, { main, copy });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await deps.stopAll();
    expect(ended.map((result) => result.outcome)).toEqual(['stopped']);
  });
});
